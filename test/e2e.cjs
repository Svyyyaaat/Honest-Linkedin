// End-to-end test: loads the unpacked extension into Chromium, serves a fake
// LinkedIn feed, and points the extension at a local mock LLM server.
//
//   npm install && npm test
//
const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert/strict");
const { chromium } = require("playwright");
const { createMock } = require("./mock-llm.cjs");

const ROOT = path.resolve(__dirname, "..");
const FEED = fs.readFileSync(path.join(__dirname, "fixture-feed.html"), "utf8");
const PORT = 18787;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}`);
    await sleep(100);
  }
}

(async () => {
  const { server, log } = createMock();
  await new Promise((r) => server.listen(PORT, r));
  const llmCalls = () => log.filter((l) => l.method === "POST").length;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: "chromium", // new headless mode, which supports extensions
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  try {
    await context.route("https://www.linkedin.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: FEED }),
    );

    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    const extId = sw.url().split("/")[2];

    // An extension page to talk to extension APIs from.
    const ext = await context.newPage();
    await ext.goto(`chrome-extension://${extId}/src/popup.html`);
    const setSettings = (s) => ext.evaluate((s) => chrome.storage.local.set({ settings: s }), s);
    const base = {
      enabled: true,
      mode: "button",
      activeProvider: "custom",
      providers: { custom: { baseUrl: `http://localhost:${PORT}/v1`, format: "openai", model: "mock-small" } },
    };
    await setSettings(base);
    // The install hook opens the options page; close it.
    for (const p of context.pages()) if (p.url().includes("options.html")) await p.close();

    // ---------------------------------------------------------- button mode
    const page = await context.newPage();
    await page.goto("https://www.linkedin.com/feed/");
    await page.waitForSelector(".hl-btn");

    const buttons = await page.$$eval(".hl-btn", (b) => b.map((x) => x.textContent));
    assert.equal(buttons.length, 4, "one button per text post (none on comments or image-only posts)");
    assert.ok(buttons.every((t) => t === "Honestify"));
    await sleep(1500);
    assert.equal(llmCalls(), 0, "button mode spends no tokens until clicked");

    const post1 = page.locator("[data-urn='urn:li:activity:1']");
    await post1.locator(".hl-btn").click();
    await waitFor(() => post1.locator(".hl-text").count(), "honest text");
    const honest = await post1.locator(".hl-text").textContent();
    assert.match(honest, /^I need attention\. \(I'm thrilled to announce/, `cleaned output, got: ${honest}`);
    assert.equal(await post1.locator(".hl-btn").textContent(), "Show original");
    assert.equal(await post1.locator(".feed-shared-inline-show-more-text").isVisible(), false, "original hidden");
    assert.equal(await post1.locator(".comments-comments-list").isVisible(), true, "comments untouched");
    const sent = log.find((l) => l.method === "POST").body.messages[1].content;
    assert.ok(!sent.includes("…more"), "'see more' toggle text not sent to the model");
    assert.ok(!sent.includes("Congrats Jane"), "comments not sent to the model");

    await post1.locator(".hl-btn").click();
    assert.equal(await post1.locator(".hl-btn").textContent(), "Honestify");
    assert.equal(await post1.locator(".feed-shared-inline-show-more-text").isVisible(), true, "original shown again");
    await post1.locator(".hl-btn").click();
    assert.equal(await post1.locator(".hl-btn").textContent(), "Show original");
    assert.equal(llmCalls(), 1, "toggling back reuses the result");

    // An idle page must stay idle: our own DOM writes must not retrigger renders.
    const mutations = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0;
          const mo = new MutationObserver((m) => (n += m.length));
          mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
          setTimeout(() => (mo.disconnect(), resolve(n)), 2000);
        }),
    );
    assert.equal(mutations, 0, "no render loop while idle");

    // Reload: the same post comes from the cache, no new API call.
    await page.reload();
    await page.waitForSelector(".hl-btn");
    await page.locator("[data-urn='urn:li:activity:1'] .hl-btn").click();
    await waitFor(() => page.locator("[data-urn='urn:li:activity:1'] .hl-text").count(), "cached text");
    assert.equal(llmCalls(), 1, "cache hit after reload");

    // ------------------------------------------------------------ auto mode
    await setSettings({ ...base, mode: "auto" });
    await page.locator("[data-urn='urn:li:activity:2']").scrollIntoViewIfNeeded();
    await waitFor(() => page.locator("[data-urn='urn:li:activity:2'] .hl-text").count(), "auto translation");
    await sleep(1500);
    assert.equal(llmCalls(), 2, "auto mode translates only the post on screen");
    assert.equal(await page.locator("[data-urn='urn:li:activity:4'] .hl-text").count(), 0, "far-away post untouched");

    // Fast scrolling past posts should not translate them.
    const before = llmCalls();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1500);
    assert.equal(llmCalls(), before, "posts flashed past during a fast scroll are skipped");

    // Dwelling on a post (incl. infinite-scroll ones) translates it.
    await page.locator("[data-urn='urn:li:activity:4']").scrollIntoViewIfNeeded();
    await waitFor(() => page.locator("[data-urn='urn:li:activity:4'] .hl-text").count(), "auto translation");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await waitFor(() => page.locator("[data-urn='urn:li:activity:6'] .hl-btn").count(), "button on lazy post");

    // "Show original" in auto mode sticks.
    const p4 = page.locator("[data-urn='urn:li:activity:4']");
    await p4.locator(".hl-btn").click();
    await sleep(1500);
    assert.equal(await p4.locator(".hl-btn").textContent(), "Honestify");

    // ------------------------------------------------------------- disable
    await setSettings({ ...base, enabled: false });
    await sleep(300);
    assert.equal(await page.locator(".hl-bar, .hl-honest").count(), 0, "disabling removes the UI");
    assert.equal(await page.locator(".hl-hidden").count(), 0, "disabling restores originals");

    // ---------------------------------------------- Anthropic format + retry
    await setSettings({
      ...base,
      activeProvider: "anthropic",
      providers: {
        anthropic: { baseUrl: `http://localhost:${PORT}/v1`, apiKey: "sk-ant-test", model: "claude-sonnet-5-5" },
      },
    });
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extId}/src/options.html`);
    const res = await opts.evaluate(() =>
      chrome.runtime.sendMessage({ type: "honestify", text: "Humbled to be speaking at a conference.", skipCache: true }),
    );
    assert.equal(res.error, undefined, res.error);
    assert.match(res.text, /^I need attention, Anthropic edition/);
    const msgCalls = log.filter((l) => l.url === "/v1/messages");
    assert.equal(msgCalls.length, 2, "rejected effort param is dropped and retried");
    assert.deepEqual(msgCalls[0].body.output_config, { effort: "low" });
    assert.equal(msgCalls[1].body.output_config, undefined);
    assert.equal(msgCalls[1].headers["x-api-key"], "sk-ant-test");
    assert.equal(msgCalls[1].headers["anthropic-dangerous-direct-browser-access"], "true");

    const models = await opts.evaluate(() =>
      chrome.runtime.sendMessage({
        type: "listModels",
        cfg: { baseUrl: "http://localhost:18787/v1", format: "openai", apiKey: "" },
      }),
    );
    assert.deepEqual(models.models, ["mock-large", "mock-small"]);

    // Options page: picking a preset fills in the endpoint.
    await opts.reload();
    await opts.selectOption("#provider", "groq");
    assert.equal(await opts.inputValue("#baseUrl"), "https://api.groq.com/openai/v1");
    assert.equal(await opts.inputValue("#model"), "llama-3.3-70b-versatile");
    await opts.selectOption("#provider", "ollama");
    assert.equal(await opts.inputValue("#baseUrl"), "http://localhost:11434/v1");
    await opts.selectOption("#model", "__custom__");
    assert.equal(await opts.locator("#customModel").isVisible(), true);

    if (process.env.SCREENSHOT_DIR) {
      await setSettings(base);
      await page.reload();
      await page.locator("[data-urn='urn:li:activity:1'] .hl-btn").click();
      await waitFor(() => page.locator("[data-urn='urn:li:activity:1'] .hl-text").count(), "text");
      await page.setViewportSize({ width: 700, height: 500 });
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, "feed.png") });
      await opts.reload();
      await sleep(300);
      await opts.setViewportSize({ width: 760, height: 1100 });
      await opts.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, "options.png"), fullPage: true });
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 320, height: 330 });
      await popup.goto(`chrome-extension://${extId}/src/popup.html`);
      await sleep(300);
      await popup.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, "popup.png") });
    }

    console.log("All end-to-end checks passed.");
  } finally {
    await context.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
