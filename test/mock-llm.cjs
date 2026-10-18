// Tiny mock of the OpenAI and Anthropic APIs for the end-to-end test.
const http = require("http");

function createMock() {
  const log = [];
  const opts = { delay: 0 };
  const server = http.createServer((req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      // Like Ollama: refuse browser-extension origins with a bare 403.
      const origin = req.headers.origin || "";
      if (/^(chrome|moz)-extension:/.test(origin)) {
        log.push({ method: req.method, url: req.url, headers: req.headers, rejected: true });
        return res.writeHead(403, cors).end("Forbidden");
      }
      if (opts.delay && req.method === "POST") await new Promise((r) => setTimeout(r, opts.delay));
      const json = body ? JSON.parse(body) : null;
      log.push({ method: req.method, url: req.url, headers: req.headers, body: json });
      const send = (status, obj) =>
        res.writeHead(status, { ...cors, "content-type": "application/json" }).end(JSON.stringify(obj));
      const user = json?.messages?.find((m) => m.role === "user")?.content || "";
      const snippet = user.replace(/<\/?post>/g, "").slice(0, 25);

      if (req.method === "GET" && req.url.startsWith("/v1/models")) {
        return send(200, { data: [{ id: "mock-small" }, { id: "mock-large" }] });
      }
      // Brainstorm mode asks for drafts + a final pick; answer in that shape.
      const system = json?.system || json?.messages?.find((m) => m.role === "system")?.content || "";
      const wrap = (t) => (system.includes("<final>") ? `<drafts>\n1. draft one\n2. draft two\n</drafts>\n<final>${t}</final>` : t);
      if (req.url === "/v1/chat/completions") {
        return send(200, { choices: [{ message: { content: wrap(`"Honest: [MOCK REPLY] ${snippet}"`) } }] });
      }
      if (req.url === "/v1/messages") {
        // Behave like an older model that rejects the effort parameter.
        if (json.output_config) {
          return send(400, { error: { type: "invalid_request_error", message: "output_config: Extra inputs are not permitted" } });
        }
        return send(200, {
          stop_reason: "end_turn",
          content: [
            { type: "thinking", thinking: "" },
            { type: "text", text: wrap(`[MOCK REPLY, Anthropic] ${snippet}`) },
          ],
        });
      }
      if (req.url === "/api/chat") {
        // Ollama's native API. "thinker" models think by default and, like a
        // small reasoning model, run out of tokens before answering; others
        // reject the think flag.
        if (json.model.startsWith("thinker")) {
          if (json.think !== false) return send(200, { message: { role: "assistant", content: "", thinking: "hmm..." } });
        } else if ("think" in json) {
          return send(400, { error: `"${json.model}" does not support thinking` });
        }
        return send(200, { message: { role: "assistant", content: wrap(`[MOCK REPLY, Ollama] ${snippet}`) } });
      }
      send(404, { error: { message: "not found" } });
    });
  });
  return { server, log, opts };
}

module.exports = { createMock };
