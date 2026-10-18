import { loadSettings, resolveProvider } from "./providers.js";

const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

let settings;

async function save(patch) {
  settings = { ...settings, ...patch };
  await api.storage.local.set({ settings });
}

function render() {
  $("enabled").checked = settings.enabled;
  $("modes").disabled = !settings.enabled;
  for (const r of document.querySelectorAll("input[name=mode]")) r.checked = r.value === settings.mode;
  const cfg = resolveProvider(settings);
  const missingKey = cfg.needsKey && !cfg.apiKey;
  $("current").textContent = missingKey
    ? `No API key for ${cfg.name} yet. Add one in Settings.`
    : `${cfg.name} · ${cfg.model || "no model"}`;
  $("current").classList.toggle("warn", missingKey);
}

$("enabled").addEventListener("change", async (e) => {
  await save({ enabled: e.target.checked });
  render();
});
for (const r of document.querySelectorAll("input[name=mode]")) {
  r.addEventListener("change", async () => {
    await save({ mode: r.value });
    render();
  });
}
$("open-options").addEventListener("click", () => {
  api.runtime.openOptionsPage();
  window.close();
});

settings = await loadSettings(api.storage);
render();
