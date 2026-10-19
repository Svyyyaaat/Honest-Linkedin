import { PROVIDERS, getPreset, loadSettings } from "./providers.js";

const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const CUSTOM = "__custom__";
const LINKEDIN = { origins: ["https://www.linkedin.com/*"] };

const SAMPLE_POST =
  "I'm excited to share that after 6 months of hard work, I've been promoted to Senior Associate Vice President of Strategic Initiatives! 🎉 None of this would have been possible without my incredible team. Remember: your attitude determines your altitude. #Growth #Leadership #Blessed";

let settings;

// ------------------------------------------------------------ form <-> state

function providerConfig(id) {
  const preset = getPreset(id);
  const saved = settings.providers?.[id] || {};
  return {
    baseUrl: saved.baseUrl ?? preset.baseUrl,
    format: saved.format || preset.format,
    apiKey: saved.apiKey || "",
    model: saved.model || preset.models[0] || "",
    fetchedModels: saved.fetchedModels || [],
  };
}

function fillModelSelect(id, selected, fetched) {
  const preset = getPreset(id);
  // Once the server has told us what it has, show only that.
  const names = [...new Set(fetched?.length ? fetched : preset.models)];
  if (selected && !names.includes(selected)) names.unshift(selected);
  const sel = $("model");
  sel.replaceChildren();
  for (const name of names) sel.add(new Option(name, name));
  sel.add(new Option("Other (type a name)…", CUSTOM));
  sel.value = selected || names[0] || CUSTOM;
  if (!names.length) sel.value = CUSTOM;
  onModelChange();
  $("model-hint").textContent =
    (fetched?.length
      ? `${fetched.length} models fetched from the API.`
      : preset.models.length
        ? "Suggested models. Use “Fetch models” to load the full list from the API."
        : "Use “Fetch models” to list what the server has.") + (preset.modelHint ? ` ${preset.modelHint}` : "");
}

function onModelChange() {
  const custom = $("model").value === CUSTOM;
  $("customModel").hidden = !custom;
  if (custom) $("customModel").focus();
}

function loadProviderIntoForm(id) {
  const cfg = providerConfig(id);
  const preset = getPreset(id);
  $("provider").value = id;
  $("baseUrl").value = cfg.baseUrl;
  $("format").value = cfg.format;
  $("apiKey").value = cfg.apiKey;
  $("apiKey").placeholder = preset.keyHint || (preset.needsKey ? "" : "Not needed for most local servers");
  $("key-optional").textContent = preset.needsKey ? "" : "(optional)";
  $("customModel").value = "";
  fillModelSelect(id, cfg.model, cfg.fetchedModels);
}

function readForm() {
  const id = $("provider").value;
  const model = $("model").value === CUSTOM ? $("customModel").value.trim() : $("model").value;
  return {
    id,
    baseUrl: $("baseUrl").value.trim().replace(/\/+$/, ""),
    format: $("format").value,
    apiKey: $("apiKey").value.trim(),
    model,
    needsKey: getPreset(id).needsKey,
  };
}

function originPattern(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

// Must be called synchronously from a click handler (Firefox requires the
// user gesture to still be "live" when permissions.request runs).
function requestEndpointAccess(url) {
  const pattern = originPattern(url);
  if (!pattern) return Promise.resolve(false);
  return api.permissions.request({ origins: [pattern] }).catch(() => false);
}

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.className = kind;
  if (kind === "ok") setTimeout(() => el.textContent === text && (el.textContent = ""), 2500);
}

async function save() {
  const form = readForm();
  if (!form.model) {
    setStatus("Pick or type a model name.", "err");
    return false;
  }
  const prev = settings.providers?.[form.id] || {};
  settings = {
    ...settings,
    enabled: $("enabled").checked,
    mode: document.querySelector("input[name=mode]:checked")?.value || "auto",
    activeProvider: form.id,
    extraInstructions: $("extraInstructions").value.trim(),
    brainstorm: $("brainstorm").checked,
    providers: {
      ...settings.providers,
      [form.id]: {
        ...prev,
        baseUrl: form.baseUrl,
        format: form.format,
        apiKey: form.apiKey,
        model: form.model,
      },
    },
  };
  await api.storage.local.set({ settings });
  setStatus("Saved.", "ok");
  return true;
}

// ------------------------------------------------------------------- events

// Local servers are free to ask, so list their models right away.
const isLocal = (url) => /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url);

$("provider").addEventListener("change", () => {
  loadProviderIntoForm($("provider").value);
  if (isLocal($("baseUrl").value)) fetchModels();
});
$("model").addEventListener("change", onModelChange);

$("toggle-key").addEventListener("click", () => {
  const show = $("apiKey").type === "password";
  $("apiKey").type = show ? "text" : "password";
  $("toggle-key").textContent = show ? "Hide" : "Show";
});

$("save").addEventListener("click", async () => {
  const access = requestEndpointAccess($("baseUrl").value);
  await save();
  await access;
});

async function fetchModels() {
  const form = readForm();
  const btn = $("refresh-models");
  btn.disabled = true;
  btn.textContent = "Fetching…";
  try {
    const res = await api.runtime.sendMessage({ type: "listModels", cfg: form });
    if (res?.error) throw new Error(res.error);
    const models = res.models || [];
    if (!models.length) throw new Error("The server returned an empty list.");
    settings.providers = {
      ...settings.providers,
      [form.id]: { ...settings.providers?.[form.id], fetchedModels: models },
    };
    await api.storage.local.set({ settings });
    fillModelSelect(form.id, models.includes(form.model) ? form.model : models[0], models);
  } catch (e) {
    $("model-hint").textContent = `Couldn't fetch models: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Fetch models";
  }
}

$("refresh-models").addEventListener("click", async () => {
  await requestEndpointAccess($("baseUrl").value);
  await fetchModels();
});

$("test").addEventListener("click", async () => {
  const access = requestEndpointAccess($("baseUrl").value);
  await access;
  if (!(await save())) return;
  const out = $("test-result");
  out.hidden = false;
  out.className = "result loading";
  out.textContent = "Honestifying…";
  const res = await api.runtime.sendMessage({
    type: "honestify",
    text: $("sample").value,
    skipCache: true,
  });
  if (res?.error) {
    out.className = "result err";
    out.textContent = res.error;
  } else {
    out.className = "result";
    out.textContent = res?.text || "(nothing)";
  }
});

$("clear-cache").addEventListener("click", async () => {
  await api.runtime.sendMessage({ type: "clearCache" });
  setStatus("Saved translations cleared.", "ok");
});

$("grant-linkedin").addEventListener("click", async () => {
  if (await api.permissions.request(LINKEDIN)) $("linkedin-access").hidden = true;
});

// --------------------------------------------------------------------- init

for (const p of PROVIDERS) $("provider").add(new Option(p.name, p.id));
settings = await loadSettings(api.storage);
$("enabled").checked = settings.enabled;
for (const r of document.querySelectorAll("input[name=mode]")) r.checked = r.value === settings.mode;
$("extraInstructions").value = settings.extraInstructions || "";
$("brainstorm").checked = settings.brainstorm;
$("sample").value = SAMPLE_POST;
loadProviderIntoForm(settings.activeProvider);
if (isLocal($("baseUrl").value)) fetchModels();

// Firefox treats host permissions as opt-in; make missing LinkedIn access obvious.
api.permissions.contains(LINKEDIN).then((ok) => ($("linkedin-access").hidden = ok));
