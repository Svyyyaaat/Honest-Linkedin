import { loadSettings, resolveProvider } from "./providers.js";
import { honestify, listModels } from "./llm.js";
import { PROMPT_VERSION } from "./prompt.js";

const api = globalThis.browser ?? globalThis.chrome;

const CACHE_KEY = "cache";
const CACHE_MAX = 400;

// Identical in-flight requests (same post seen twice) share one API call.
const inflight = new Map();

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function cacheGet(key) {
  const { [CACHE_KEY]: cache = {} } = await api.storage.local.get(CACHE_KEY);
  return cache[key]?.t;
}

async function cachePut(key, text) {
  const { [CACHE_KEY]: cache = {} } = await api.storage.local.get(CACHE_KEY);
  cache[key] = { t: text, ts: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys
      .sort((a, b) => cache[a].ts - cache[b].ts)
      .slice(0, keys.length - CACHE_MAX)
      .forEach((k) => delete cache[k]);
  }
  await api.storage.local.set({ [CACHE_KEY]: cache });
}

async function handleHonestify({ text, skipCache }) {
  const settings = await loadSettings(api.storage);
  const cfg = resolveProvider(settings);
  const key = await sha256(
    [PROMPT_VERSION, cfg.format, cfg.baseUrl, cfg.model, settings.brainstorm, settings.extraInstructions, text].join(
      "\u0000",
    ),
  );
  if (!skipCache) {
    const hit = await cacheGet(key);
    if (hit) return { text: hit, cached: true };
  }
  if (!inflight.has(key)) {
    const p = honestify(cfg, text, settings)
      .then(async (out) => {
        await cachePut(key, out);
        return out;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return { text: await inflight.get(key), cached: false };
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  let work;
  switch (msg?.type) {
    case "honestify":
      work = handleHonestify(msg);
      break;
    case "listModels":
      work = listModels(msg.cfg).then((models) => ({ models }));
      break;
    case "clearCache":
      work = api.storage.local.remove(CACHE_KEY).then(() => ({ ok: true }));
      break;
    case "openOptions":
      work = api.runtime.openOptionsPage().then(() => ({ ok: true }));
      break;
    default:
      return false;
  }
  work.then(sendResponse, (e) => sendResponse({ error: e?.message || String(e) }));
  return true; // keep the channel open for the async response
});

api.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") api.runtime.openOptionsPage();
});
