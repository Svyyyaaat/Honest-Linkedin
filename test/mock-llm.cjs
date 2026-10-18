// Tiny mock of the OpenAI and Anthropic APIs for the end-to-end test.
const http = require("http");

function createMock() {
  const log = [];
  const server = http.createServer((req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : null;
      log.push({ method: req.method, url: req.url, headers: req.headers, body: json });
      const send = (status, obj) =>
        res.writeHead(status, { ...cors, "content-type": "application/json" }).end(JSON.stringify(obj));
      const user = json?.messages?.find((m) => m.role === "user")?.content || "";
      const snippet = user.replace(/<\/?post>/g, "").slice(0, 25);

      if (req.method === "GET" && req.url.startsWith("/v1/models")) {
        return send(200, { data: [{ id: "mock-small" }, { id: "mock-large" }] });
      }
      if (req.url === "/v1/chat/completions") {
        return send(200, { choices: [{ message: { content: `"Honest: I need attention. (${snippet})"` } }] });
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
            { type: "text", text: `I need attention, Anthropic edition. (${snippet})` },
          ],
        });
      }
      send(404, { error: { message: "not found" } });
    });
  });
  return { server, log };
}

module.exports = { createMock };
