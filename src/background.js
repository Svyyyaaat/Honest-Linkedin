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

// Local servers (Ollama, LM Studio...) often reject requests whose Origin is
// chrome-extension:// or moz-extension:// with a 403. For hosts on this machine
// or LAN, rewrite our own requests' Origin to the server's own origin, which
// they always accept. Only affects requests made by this extension.
const LOCAL_HOST_RE =
  /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1\]|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|[^.]+\.local)$/i;
const ORIGIN_RULE_ID = 1;
let originRuleFor = null;

async function allowLocalServer(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return;
  }
  if (!LOCAL_HOST_RE.test(url.hostname) || originRuleFor === url.origin || !api.declarativeNetRequest) return;
  try {
    await api.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ORIGIN_RULE_ID],
      addRules: [
        {
          id: ORIGIN_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "origin", operation: "set", value: url.origin }],
          },
          condition: {
            urlFilter: `|${url.origin}/`,
            resourceTypes: ["xmlhttprequest"],
            tabIds: [-1], // requests not made from a tab, i.e. by the extension itself
          },
        },
      ],
    });
    originRuleFor = url.origin;
  } catch (e) {
    console.warn("Honest LinkedIn: could not set the Origin rule for", url.origin, e);
  }
}

async function handleHonestify({ text, skipCache }) {
  const settings = await loadSettings(api.storage);
  const cfg = resolveProvider(settings);
  await allowLocalServer(cfg.baseUrl);
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
      work = allowLocalServer(msg.cfg?.baseUrl)
        .then(() => listModels(msg.cfg))
        .then((models) => ({ models }));
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
