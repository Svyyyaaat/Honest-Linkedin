(() => {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;

  // LinkedIn changes its markup often. All DOM knowledge lives here.
  const POST_SELECTORS = [
    "div.feed-shared-update-v2",
    "div[data-urn^='urn:li:activity']",
    "div[data-id^='urn:li:activity']",
    "article[data-activity-urn]",
    "div.occludable-update",
  ];
  const TEXT_SELECTORS = [
    ".update-components-text",
    ".feed-shared-update-v2__description",
    ".feed-shared-inline-show-more-text",
    ".feed-shared-text",
    "[data-test-id='main-feed-activity-card__commentary']",
    ".attributed-text-segment-list__content",
  ];
  // Text inside these belongs to comments, not to the post.
  const EXCLUDE_ANCESTORS =
    "[class*='comments-comment'], .comments-comments-list, [class*='comment-item'], .hl-bar, .hl-honest";

  const MIN_TEXT_LENGTH = 20;
  const AUTO_DWELL_MS = 900; // post must stay on screen this long before auto mode spends tokens
  const MAX_CONCURRENT = 2;

  let settings = { enabled: true, mode: "button" };
  const states = new Map(); // post element -> state

  // ---------------------------------------------------------------- DOM utils

  function findPosts(root) {
    const found = new Set();
    for (const sel of POST_SELECTORS) {
      root.querySelectorAll(sel).forEach((el) => found.add(el));
    }
    // Keep only the outermost match so a post isn't handled twice.
    return [...found].filter((el) => {
      const parent = el.parentElement?.closest(POST_SELECTORS.join(","));
      return !parent || !found.has(parent);
    });
  }

  function findTextEl(post) {
    for (const sel of TEXT_SELECTORS) {
      for (const el of post.querySelectorAll(sel)) {
        if (el.closest(EXCLUDE_ANCESTORS)) continue;
        if (readText(el).length >= MIN_TEXT_LENGTH) {
          // Prefer the outer wrapper that also contains the "see more" toggle,
          // so hiding it hides everything.
          return el.closest(".feed-shared-inline-show-more-text") || el;
        }
      }
    }
    // Fallback: the longest left-to-right text block that isn't in comments.
    let best = null;
    let bestLen = 80;
    for (const el of post.querySelectorAll("[dir='ltr'], [dir='auto']")) {
      if (el.closest(EXCLUDE_ANCESTORS)) continue;
      const len = readText(el).length;
      if (len > bestLen) {
        best = el;
        bestLen = len;
      }
    }
    return best;
  }

  function readText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll("button, .visually-hidden, .hl-bar, .hl-honest").forEach((n) => n.remove());
    clone.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
    return (clone.textContent || "")
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/…\s*(see )?more\s*$/i, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // ------------------------------------------------------------------ queue

  const queue = [];
  let running = 0;

  function enqueue(job) {
    return new Promise((resolve, reject) => {
      queue.push({ job, resolve, reject });
      pump();
    });
  }

  function pump() {
    while (running < MAX_CONCURRENT && queue.length) {
      const { job, resolve, reject } = queue.shift();
      running++;
      job()
        .then(resolve, reject)
        .finally(() => {
          running--;
          pump();
        });
    }
  }

  async function requestHonest(text) {
    const res = await api.runtime.sendMessage({ type: "honestify", text });
    if (!res) throw new Error("No response from the extension. Try reloading the page.");
    if (res.error) throw new Error(res.error);
    return res.text;
  }

  // -------------------------------------------------------------- post state
  // view: "original" | "loading" | "honest" | "error"

  function getState(post) {
    let st = states.get(post);
    if (!st) {
      st = { view: "original", honest: null, error: null, userChose: false, timer: null };
      states.set(post, st);
    }
    return st;
  }

  function ensureUI(post) {
    const st = getState(post);
    const textEl = st.textEl?.isConnected && post.contains(st.textEl) ? st.textEl : findTextEl(post);
    if (!textEl) return null;
    st.textEl = textEl;

    if (!st.bar) {
      st.bar = document.createElement("div");
      st.bar.className = "hl-bar";
      st.button = document.createElement("button");
      st.button.type = "button";
      st.button.className = "hl-btn";
      st.button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onButton(post);
      });
      st.bar.append(st.button);

      st.honestEl = document.createElement("div");
      st.honestEl.className = "hl-honest";
      st.honestEl.setAttribute("lang", "");
    }
    // (Re)attach if new or LinkedIn re-rendered and dropped our nodes. Only
    // touch the DOM when needed: our own mutations trigger another scan.
    if (st.bar.nextElementSibling !== st.honestEl || st.honestEl.nextElementSibling !== textEl) {
      textEl.before(st.bar, st.honestEl);
      render(post);
    } else if (textEl.classList.contains("hl-hidden") !== (st.view === "honest")) {
      render(post);
    }
    return st;
  }

  function render(post) {
    const st = getState(post);
    if (!st.bar) return;
    const { button, honestEl, textEl } = st;
    button.disabled = st.view === "loading";
    button.classList.toggle("hl-loading", st.view === "loading");

    switch (st.view) {
      case "loading":
        button.textContent = "Honestifying…";
        break;
      case "honest":
        button.textContent = "Show original";
        break;
      case "error":
        button.textContent = "Try again";
        break;
      default:
        button.textContent = "Honestify";
    }

    honestEl.replaceChildren();
    honestEl.hidden = st.view !== "honest" && st.view !== "error";
    if (st.view === "honest") {
      const label = document.createElement("div");
      label.className = "hl-label";
      label.textContent = "What they actually mean";
      const body = document.createElement("div");
      body.className = "hl-text";
      body.textContent = st.honest;
      honestEl.append(label, body);
      honestEl.classList.remove("hl-error");
    } else if (st.view === "error") {
      honestEl.classList.add("hl-error");
      const msg = document.createElement("span");
      msg.textContent = st.error + " ";
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = "Settings";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        api.runtime.sendMessage({ type: "openOptions" });
      });
      honestEl.append(msg, link);
    }
    if (textEl) textEl.classList.toggle("hl-hidden", st.view === "honest");
  }

  function onButton(post) {
    const st = getState(post);
    st.userChose = true;
    if (st.view === "honest") {
      st.view = "original";
      render(post);
    } else if (st.honest) {
      st.view = "honest"; // already paid for this one
      render(post);
    } else if (st.view !== "loading") {
      honestifyPost(post);
    }
  }

  async function honestifyPost(post) {
    const st = getState(post);
    if (!st.textEl) return;
    const text = readText(st.textEl);
    if (text.length < MIN_TEXT_LENGTH) return;
    st.view = "loading";
    render(post);
    try {
      st.honest = await enqueue(() => requestHonest(text));
      // Respect a "show original" click that happened while we were waiting.
      if (st.view === "loading") st.view = "honest";
    } catch (e) {
      st.error = e.message || String(e);
      st.view = "error";
    }
    render(post);
  }

  // --------------------------------------------------------------- auto mode
  // Only posts that actually sit on screen for a moment get translated;
  // nothing is fetched ahead of the scroll position.

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const post = entry.target;
        const st = getState(post);
        if (entry.isIntersecting) {
          if (st.timer || st.honest || st.userChose || st.view !== "original") continue;
          st.timer = setTimeout(() => {
            st.timer = null;
            if (settings.enabled && settings.mode === "auto" && !st.userChose && !st.honest) {
              honestifyPost(post);
            }
          }, AUTO_DWELL_MS);
        } else if (st.timer) {
          clearTimeout(st.timer);
          st.timer = null;
        }
      }
    },
    { threshold: 0.5 },
  );

  // ------------------------------------------------------------------- scan

  function scan() {
    if (!settings.enabled) return;
    for (const post of findPosts(document)) {
      const st = ensureUI(post);
      if (!st) continue;
      if (!st.observed) {
        io.observe(post);
        st.observed = true;
      }
    }
    // Forget posts LinkedIn removed from the page.
    for (const [post, st] of states) {
      if (!post.isConnected) {
        if (st.timer) clearTimeout(st.timer);
        io.unobserve(post);
        states.delete(post);
      }
    }
  }

  function teardown() {
    for (const [post, st] of states) {
      if (st.timer) clearTimeout(st.timer);
      io.unobserve(post);
      st.bar?.remove();
      st.honestEl?.remove();
      st.textEl?.classList.remove("hl-hidden");
    }
    states.clear();
  }

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      scan();
    }, 250);
  }

  // ------------------------------------------------------------------- init

  function applySettings(next) {
    const wasEnabled = settings.enabled;
    settings = { enabled: true, mode: "button", ...(next || {}) };
    if (!settings.enabled) {
      teardown();
      return;
    }
    if (!wasEnabled) scan();
    if (settings.mode === "auto") {
      // Re-arm the observer so posts already on screen get picked up.
      for (const post of states.keys()) {
        io.unobserve(post);
        io.observe(post);
      }
    }
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) applySettings(changes.settings.newValue);
  });

  api.storage.local.get("settings").then(({ settings: s }) => {
    applySettings(s);
    scan();
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  });
})();
