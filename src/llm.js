import { SYSTEM_PROMPT, buildUserMessage, cleanOutput } from "./prompt.js";

const REQUEST_TIMEOUT_MS = 60000;

export class LLMError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function headersFor(cfg) {
  const h = { "content-type": "application/json" };
  if (cfg.format === "anthropic") {
    h["anthropic-version"] = "2023-06-01";
    // Required by Anthropic for requests that carry a browser Origin header.
    h["anthropic-dangerous-direct-browser-access"] = "true";
    if (cfg.apiKey) h["x-api-key"] = cfg.apiKey;
  } else if (cfg.apiKey) {
    h["authorization"] = `Bearer ${cfg.apiKey}`;
  }
  return h;
}

async function fetchJSON(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e.name === "AbortError") throw new LLMError("Request timed out.");
    throw new LLMError(`Could not reach ${new URL(url).host}. ${e.message || ""}`.trim());
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body; keep raw text for the error message
  }
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      (typeof data?.error === "string" ? data.error : null) ||
      data?.message ||
      text.slice(0, 300) ||
      res.statusText;
    throw new LLMError(`${res.status}: ${msg}`, res.status);
  }
  return data;
}

// Send a request; if the server rejects one of the optional tuning params
// (models differ wildly in what they accept), drop it and retry.
async function postWithFallback(url, cfg, body, optional) {
  const opt = { ...optional };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fetchJSON(url, {
        method: "POST",
        headers: headersFor(cfg),
        body: JSON.stringify({ ...body, ...opt }),
      });
    } catch (e) {
      if (e.status !== 400 && e.status !== 422) throw e;
      const culprit = Object.keys(opt).find((k) => e.message.includes(k));
      if (!culprit) throw e;
      // max_completion_tokens is required by some servers and unknown to
      // others; swap it for the classic name instead of dropping it.
      if (culprit === "max_completion_tokens") opt.max_tokens = opt.max_completion_tokens;
      if (culprit === "max_tokens" && !("max_completion_tokens" in optional)) {
        opt.max_completion_tokens = opt.max_tokens;
      }
      delete opt[culprit];
    }
  }
  throw new LLMError("The API kept rejecting the request parameters.");
}

// Claude 4.6+ models accept effort; "low" keeps thinking (and cost) minimal.
const CLAUDE_EFFORT_RE = /claude-(opus|sonnet|haiku|fable|mythos)-(5|4-[6-9])/;

async function callAnthropic(cfg, system, user) {
  const optional = {};
  if (CLAUDE_EFFORT_RE.test(cfg.model)) optional.output_config = { effort: "low" };
  const data = await postWithFallback(
    `${cfg.baseUrl}/messages`,
    cfg,
    {
      model: cfg.model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    },
    optional,
  );
  if (data?.stop_reason === "refusal") throw new LLMError("The model declined this one.");
  const text = (data?.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return text;
}

const REASONING_MODEL_RE = /^(openai\/)?(gpt-5|o\d)/;

async function callOpenAI(cfg, system, user) {
  const optional = {};
  if (REASONING_MODEL_RE.test(cfg.model)) {
    // Reasoning models burn hidden tokens; keep it light and leave room.
    optional.reasoning_effort = "low";
    optional.max_completion_tokens = 2000;
  } else {
    optional.max_tokens = 400;
  }
  const data = await postWithFallback(
    `${cfg.baseUrl}/chat/completions`,
    cfg,
    {
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    optional,
  );
  const content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) return content.map((p) => p.text || "").join("");
  return content || "";
}

export async function honestify(cfg, postText, extraInstructions) {
  if (!cfg.baseUrl) throw new LLMError("No API endpoint set. Open the settings.");
  if (!cfg.model) throw new LLMError("No model selected. Open the settings.");
  if (cfg.needsKey && !cfg.apiKey) throw new LLMError("No API key set. Open the settings.");
  const user = buildUserMessage(postText, extraInstructions);
  const raw =
    cfg.format === "anthropic"
      ? await callAnthropic(cfg, SYSTEM_PROMPT, user)
      : await callOpenAI(cfg, SYSTEM_PROMPT, user);
  const out = cleanOutput(raw);
  if (!out) throw new LLMError("The model returned nothing. Maybe it was speechless.");
  return out;
}

export async function listModels(cfg) {
  if (!cfg.baseUrl) throw new LLMError("Set an API endpoint first.");
  const data = await fetchJSON(`${cfg.baseUrl}/models?limit=1000`, {
    method: "GET",
    headers: headersFor(cfg),
  });
  // Anthropic / OpenAI / most compatibles: { data: [{ id }] }; Ollama native: { models: [{ name }] }
  const list = data?.data || data?.models || [];
  return list
    .map((m) => (typeof m === "string" ? m : m.id || m.name))
    .filter(Boolean)
    .sort();
}
