// Preset API endpoints. Picking one in the settings auto-fills the base URL,
// API format and suggested models. Everything stays editable, and "Custom"
// covers any other OpenAI-compatible (or Anthropic-compatible) server.
//
// format: "anthropic" -> POST {baseUrl}/messages        (Anthropic Messages API)
//         "openai"    -> POST {baseUrl}/chat/completions (OpenAI-compatible)
// Both formats list models with GET {baseUrl}/models.

export const PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com/v1",
    format: "anthropic",
    needsKey: true,
    keyHint: "sk-ant-…",
    modelHint:
      "In our tests Haiku 5.5 handled this style nearly as well as Opus 5.5, at about 1/40 of the cost.",
    models: [
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-fable-5-1",
      "claude-haiku-4-5",
      "claude-sonnet-4-6",
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    format: "openai",
    needsKey: true,
    keyHint: "sk-…",
    models: ["gpt-5-mini", "gpt-5", "gpt-5-nano", "gpt-4.1-mini", "gpt-4o-mini"],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    format: "openai",
    needsKey: true,
    keyHint: "AIza…",
    models: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    format: "openai",
    needsKey: true,
    keyHint: "sk-or-…",
    models: [
      "anthropic/claude-haiku-4.5",
      "anthropic/claude-sonnet-4.6",
      "openai/gpt-5-mini",
      "google/gemini-2.5-flash",
      "meta-llama/llama-3.3-70b-instruct",
      "deepseek/deepseek-chat",
    ],
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    format: "openai",
    needsKey: true,
    keyHint: "gsk_…",
    models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant"],
  },
  {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    format: "openai",
    needsKey: true,
    models: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    format: "openai",
    needsKey: true,
    models: ["deepseek-chat"],
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    format: "openai",
    needsKey: true,
    keyHint: "xai-…",
    models: ["grok-3-mini", "grok-4"],
  },
  {
    id: "together",
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    format: "openai",
    needsKey: true,
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    format: "openai",
    needsKey: false,
    models: ["llama3.2", "qwen2.5", "gemma3", "mistral"],
  },
  {
    id: "lmstudio",
    name: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    format: "openai",
    needsKey: false,
    models: [],
  },
  {
    id: "custom",
    name: "Custom endpoint",
    baseUrl: "",
    format: "openai",
    needsKey: false,
    models: [],
  },
];

export function getPreset(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[PROVIDERS.length - 1];
}

export const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "auto", // "auto" = honestify as you scroll, "button" = click to honestify
  activeProvider: "anthropic",
  // Per-provider overrides: { [providerId]: { baseUrl, format, apiKey, model, fetchedModels } }
  providers: {},
  extraInstructions: "",
  brainstorm: false, // draft 3 options and keep the best; ~3x output tokens
};

// Resolve the effective endpoint config for the active provider.
export function resolveProvider(settings) {
  const id = settings.activeProvider || DEFAULT_SETTINGS.activeProvider;
  const preset = getPreset(id);
  const saved = (settings.providers && settings.providers[id]) || {};
  return {
    id,
    name: preset.name,
    baseUrl: (saved.baseUrl ?? preset.baseUrl).replace(/\/+$/, ""),
    format: saved.format || preset.format,
    apiKey: saved.apiKey || "",
    model: saved.model || preset.models[0] || "",
    needsKey: preset.needsKey,
  };
}

export async function loadSettings(storage) {
  const { settings } = await storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}
