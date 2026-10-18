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
const FEED_NEW = fs.readFileSync(path.join(__dirname, "fixture-feed-new.html"), "utf8");
const FEED_2026 = fs.readFileSync(path.join(__dirname, "fixture-feed-2026.html"), "utf8");
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
  const { server, log, opts: mock } = createMock();
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
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: route.request().url().includes("feed-2026")
          ? FEED_2026
          : route.request().url().includes("new-feed")
            ? FEED_NEW
            : FEED,
      }),
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
    mock.delay = 800;
    await post1.locator(".hl-btn").click();
    await sleep(200);
    assert.equal(await post1.locator(".hl-translating").count(), 1, "shimmer over the original while translating");
    await waitFor(() => post1.locator(".hl-text").count(), "honest text");
    const running = await post1.evaluate((el) => ({
      words: el.querySelectorAll(".hl-animate .hl-w").length,
      animations: el.querySelector(".hl-honest").getAnimations({ subtree: true }).length,
    }));
    assert.ok(running.words > 3 && running.animations > 0, `reveal animation runs: ${JSON.stringify(running)}`);
    assert.equal(await post1.locator(".hl-translating").count(), 0, "shimmer removed after reveal");
    mock.delay = 0;
    const honest = await post1.locator(".hl-text").textContent();
    assert.match(honest, /^\[MOCK REPLY\] I.m thrilled to announce/, `cleaned output, got: ${honest}`);
    assert.equal(await post1.locator(".hl-btn").textContent(), "Show original");
    assert.equal(await post1.locator(".feed-shared-inline-show-more-text:not(.hl-honest *)").isVisible(), false, "original hidden");
    assert.equal(await post1.locator(".comments-comments-list").isVisible(), true, "comments untouched");
    assert.ok(!log.some((l) => l.rejected), "local server's Origin check passes (Origin rewritten for localhost)");
    const sent = log.find((l) => l.method === "POST").body.messages[1].content;
    assert.ok(!sent.includes("…more"), "'see more' toggle text not sent to the model");
    assert.ok(!sent.includes("Congrats Jane"), "comments not sent to the model");
    assert.ok(!log.find((l) => l.method === "POST").body.messages[0].content.includes("<final>"), "brainstorm off by default");

    await post1.locator(".hl-btn").click();
    assert.equal(await post1.locator(".hl-btn").textContent(), "Honestify");
    assert.equal(await post1.locator(".feed-shared-inline-show-more-text:not(.hl-honest *)").isVisible(), true, "original shown again");
    await post1.locator(".hl-btn").click();
    assert.equal(await post1.locator(".hl-btn").textContent(), "Show original");
    assert.equal(llmCalls(), 1, "toggling back reuses the result");

    // An idle page must stay idle (once the reveal animation has finished)
    // and our own DOM writes must not retrigger renders.
    await sleep(1800);
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

    // ----------------------------------------------- LinkedIn 2026 feed markup
    {
      const p3 = await context.newPage();
      await p3.goto("https://www.linkedin.com/feed-2026/");
      await p3.waitForSelector("#p1 .hl-btn");
      await waitFor(() => p3.locator("#p3 .hl-btn").count(), "button on the lazily loaded post");
      await sleep(600);
      for (const id of ["p1", "p2", "p3"]) {
        assert.equal(await p3.locator(`#${id} .hl-btn`).count(), 1, `exactly one button on ${id}`);
      }
      assert.equal(await p3.locator(".hl-btn").count(), 3, "no buttons on 'Start a post', 'New posts' or the comment");
      assert.ok(await p3.locator("#p2 .hl-bar + .hl-honest + p").count(), "promoted post (5 buttons) handled");
      assert.ok(await p3.locator("#p3 .hl-bar + .hl-honest + p .etb").count(), "bar sits on the post, not the comment");

      await p3.locator("#p1 .hl-btn").click();
      await waitFor(() => p3.locator("#p1 .hl-text").count(), "translation shown");
      // Dressed like the original paragraph: same tags and classes, no ids.
      const dress = await p3.locator("#p1 .hl-honest").evaluate((h) => {
        const p = h.querySelector("p");
        const span = p.querySelector("span.hl-text");
        return {
          pClass: p.className,
          spanClass: span.className.replace(" hl-text", ""),
          testid: !!h.querySelector("[data-testid], [componentkey]"),
          label: h.querySelector(".hl-label").textContent,
          fontSize: getComputedStyle(span).fontSize,
          color: getComputedStyle(span).color,
        };
      });
      assert.equal(dress.pClass, "pt clamp");
      assert.equal(dress.spanClass, "etb x1 x2 clamp");
      assert.equal(dress.testid, false, "identifying attributes stripped");
      assert.equal(dress.label, "What they actually mean");
      assert.equal(dress.fontSize, "14px");
      assert.equal(dress.color, "rgb(25, 25, 25)", "same text colour as a normal post");
      assert.equal(await p3.locator("#p1 p.pt:not(.hl-honest *)").isVisible(), false, "original paragraph hidden");
      // A collapsed post: the full text was sent and the translation isn't clamped.
      const sent2026 = log.filter((l) => l.method === "POST").at(-1).body.messages.at(-1).content;
      assert.ok(sent2026.includes("worked weekends. Grateful!"), "text hidden behind …more is sent too");
      await sleep(1700); // let the reveal animation finish
      const clamp = await p3.locator("#p1 .hl-text").evaluate((el) => ({
        lineClamp: getComputedStyle(el).webkitLineClamp,
        cut: el.scrollHeight > el.clientHeight + 1,
      }));
      assert.deepEqual(clamp, { lineClamp: "none", cut: false }, "translation shown in full, not cut off");
      const btn = await p3.locator("#p1 .hl-btn").evaluate((b) => getComputedStyle(b).color);
      assert.equal(btn, "rgb(10, 102, 194)", "LinkedIn blue button");
      await sleep(400);
      assert.equal(await p3.locator(".hl-btn").count(), 3, "translation not mistaken for another post");
      await p3.close();
    }

    // ------------------------------------------ unknown markup (shape heuristic)
    {
      const p2 = await context.newPage();
      await p2.goto("https://www.linkedin.com/new-feed/");
      await p2.waitForSelector(".hl-btn");
      await sleep(500);
      assert.equal(await p2.locator(".hl-btn").count(), 2, "one button per post in the new layout (none on header, aside, comments)");
      const card = p2.locator("._c1").first();
      assert.equal(await card.locator(".hl-btn").count(), 1);
      // The bar sits right above the post text, not the headline or the comment.
      const nextIsText = await card.locator(".hl-bar").evaluate(
        (bar) => bar.nextElementSibling.nextElementSibling.classList.contains("_t9q"),
      );
      assert.ok(nextIsText, "text block found (and grown to include the …more button)");
      const before = llmCalls();
      await card.locator(".hl-btn").click();
      await waitFor(() => card.locator(".hl-text").count(), "honest text (new layout)");
      const sentNew = log.filter((l) => l.method === "POST").at(-1).body.messages.at(-1).content;
      assert.ok(sentNew.includes("Today is the birthday") && sentNew.includes("Let me know what you think"), "whole post sent");
      assert.ok(!sentNew.includes("Talent Investor") && !sentNew.includes("Congratulations Alina"), "no headline or comment");
      assert.ok(!sentNew.includes("…more"), "no …more");
      assert.equal(await card.locator("._t9q:not(.hl-honest *)").isVisible(), false, "original hidden");
      assert.equal(await card.locator("._img").isVisible(), true, "image untouched");
      assert.equal(llmCalls(), before + 1);
      // LinkedIn re-renders posts; the button must come back.
      await p2.evaluate(() => document.querySelectorAll(".hl-bar, .hl-honest").forEach((n) => n.remove()));
      await waitFor(() => card.locator(".hl-btn").count(), "button re-attached after re-render");
      assert.equal(await card.locator(".hl-btn").textContent(), "Show original", "state kept across re-render");
      await p2.close();
    }

    // ------------------------------------------------------------ auto mode
    await setSettings({ ...base, mode: "auto" });
    const beforeAuto = llmCalls();
    await page.locator("[data-urn='urn:li:activity:2']").scrollIntoViewIfNeeded();
    await waitFor(() => page.locator("[data-urn='urn:li:activity:2'] .hl-text").count(), "auto translation");
    await sleep(1500);
    assert.equal(llmCalls(), beforeAuto + 1, "auto mode translates only the post on screen");
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
    assert.match(res.text, /^\[MOCK REPLY, Anthropic\]/);
    const msgCalls = log.filter((l) => l.url === "/v1/messages");
    assert.equal(msgCalls.length, 2, "rejected effort param is dropped and retried");
    assert.deepEqual(msgCalls[0].body.output_config, { effort: "low" });
    assert.equal(msgCalls[1].body.output_config, undefined);
    assert.equal(msgCalls[1].headers["x-api-key"], "sk-ant-test");
    assert.equal(msgCalls[1].headers["anthropic-dangerous-direct-browser-access"], "true");

    // Ollama: native API with thinking off; retried without the flag for
    // models that don't think.
    for (const model of ["thinker:4b", "plain:3b"]) {
      await setSettings({
        ...base,
        activeProvider: "ollama",
        providers: { ollama: { baseUrl: `http://localhost:${PORT}/v1`, model } },
      });
      const r = await opts.evaluate(() =>
        chrome.runtime.sendMessage({ type: "honestify", text: "Grateful to announce my new role!", skipCache: true }),
      );
      assert.equal(r.error, undefined, `${model}: ${r.error}`);
      assert.match(r.text, /^\[MOCK REPLY, Ollama\]/);
    }
    const ollamaCalls = log.filter((l) => l.url === "/api/chat");
    assert.equal(ollamaCalls[0].body.think, false, "thinking switched off");
    assert.equal(ollamaCalls.length, 3, "one call for the thinking model, two (retry without flag) for the other");

    // Options page with a local server: lists exactly the server's models.
    await opts.reload();
    await waitFor(
      () => opts.$$eval("#model option", (o) => o.map((x) => x.value).join(",") === "mock-large,mock-small,__custom__"),
      "only the server's own models listed",
    );
    await setSettings(base);

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
      await page.setViewportSize({ width: 700, height: 500 });
      await ext.evaluate(() => chrome.runtime.sendMessage({ type: "clearCache" }));
      mock.delay = 1600;
      const shot = (name) => page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, name) });
      await page.locator("[data-urn='urn:li:activity:2']").evaluate((el) => el.scrollIntoView());
      await page.locator("[data-urn='urn:li:activity:2'] .hl-btn").click();
      await sleep(400);
      await shot("anim-1-shimmer.png");
      await sleep(500);
      await shot("anim-2-shimmer.png");
      await waitFor(() => page.locator("[data-urn='urn:li:activity:2'] .hl-text").count(), "text");
      // Freeze the reveal part-way through to capture it.
      await page.evaluate(() => document.getAnimations().forEach((a) => (a.pause(), (a.currentTime = 300))));
      await shot("anim-3-reveal.png");
      await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
      await sleep(1200);
      await shot("anim-4-done.png");
      mock.delay = 0;
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
