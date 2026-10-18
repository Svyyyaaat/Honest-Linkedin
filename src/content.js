(() => {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;

  // LinkedIn changes its markup often (and its newer feed uses generated class
  // names), so known selectors are tried first and a structural heuristic
  // catches everything else. All DOM knowledge lives here.
  const POST_SELECTORS = [
    "div.feed-shared-update-v2",
    "div[data-urn^='urn:li:activity']",
    "div[data-id^='urn:li:activity']",
    "article[data-activity-urn]",
    "div.occludable-update",
    "[data-view-name='feed-full-update']",
  ];
  // Current feed (2026): each post is a role="listitem" card inside
  // data-testid="mainFeed"; its text is <p><span data-testid="expandable-text-box">.
  const FEED_TEXT = "[data-testid='expandable-text-box']";
  const TEXT_SELECTORS = [
    FEED_TEXT,
    ".update-components-text",
    ".feed-shared-update-v2__description",
    ".feed-shared-inline-show-more-text",
    ".feed-shared-text",
    "[data-test-id='main-feed-activity-card__commentary']",
    ".attributed-text-segment-list__content",
    "[data-view-name='feed-commentary']",
  ];
  // Text inside these belongs to comments, not to the post.
  const EXCLUDE_ANCESTORS =
    "[class*='comments-comment'], .comments-comments-list, [class*='comment-item'], " +
    "[data-view-name*='comment'], .hl-bar, .hl-honest";
  // Every post has a link to its author.
  const PROFILE_LINK = "a[href*='/in/'], a[href*='/company/'], a[href*='/school/'], a[href*='/showcase/']";
  // A post card has an action row (like, comment, repost, send) plus menus;
  // a comment has fewer buttons, which keeps comments from passing as posts.
  const MIN_POST_BUTTONS = 6;
  const INLINE_TAGS = new Set(
    "SPAN A STRONG B EM I U S BR WBR SMALL MARK CODE SUB SUP ABBR TIME LABEL IMG".split(" "),
  );

  const MIN_TEXT_LENGTH = 20;
  const MIN_DISCOVERY_LENGTH = 60; // text needed for the heuristic to treat something as a post
  const AUTO_DWELL_MS = 900; // post must stay on screen this long before auto mode spends tokens
  const MAX_CONCURRENT = 2;

  let settings = { enabled: true, mode: "button" };
  const states = new Map(); // post element -> state

  // ---------------------------------------------------------------- DOM utils

  const textLen = (el) => (el.textContent || "").trim().length;

  function findPosts(root) {
    const found = new Set();
    for (const sel of POST_SELECTORS) {
      root.querySelectorAll(sel).forEach((el) => found.add(el));
    }
    root.querySelectorAll(FEED_TEXT).forEach((text) => {
      if (text.closest(".hl-honest")) return;
      const item = feedItemOf(text);
      if (item) found.add(item);
    });
    // Unknown layout: fall back to guessing from the page's shape.
    if (!found.size) {
      root.querySelectorAll(`[${POST_MARK}]`).forEach((el) => found.add(el)); // found earlier by the heuristic
      for (const el of discoverPosts(root)) found.add(el);
    }
    // Keep only the outermost match so a post isn't handled twice.
    return [...found].filter((el) => {
      for (let a = el.parentElement; a; a = a.parentElement) if (found.has(a)) return false;
      return true;
    });
  }

  // The feed card holding an element: its outermost role="listitem" below the
  // feed list (comments can be list items nested inside a post).
  function feedItemOf(el) {
    let item = null;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.getAttribute("role") === "listitem") item = a;
      if (a.getAttribute("data-testid") === "mainFeed") break;
    }
    return item;
  }

  // Paragraph-level block holding a text node: its closest non-inline ancestor.
  function blockOf(el) {
    while (el && INLINE_TAGS.has(el.tagName)) el = el.parentElement;
    return el;
  }

  // Grow a text block to the wrapper that holds just the post text (all its
  // paragraphs and the "…more" toggle), stopping before headers or media.
  function hoistText(el, stopAt) {
    let cur = el;
    for (let p = cur.parentElement; p && p !== stopAt; p = p.parentElement) {
      if (textLen(p) > textLen(cur) + 40 || p.querySelector("img, video") || p.querySelectorAll("button").length > 2) {
        break;
      }
      cur = p;
    }
    return cur;
  }

  // Structural fallback: long text whose surroundings look like a post card.
  // Found posts are marked so later scans skip them in O(depth); text blocks
  // that aren't in a post are remembered for a while (buttons load lazily, so
  // not forever).
  const POST_MARK = "data-hl-post";
  let notPosts = new WeakSet();
  setInterval(() => (notPosts = new WeakSet()), 5000);

  function discoverPosts(root) {
    const scope = root.querySelector?.("main") || root.body || root;
    const blocks = new Set();
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim().length >= 20 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    for (let n; (n = walker.nextNode()); ) {
      const block = blockOf(n.parentElement);
      if (block && !blocks.has(block)) blocks.add(block);
    }
    const posts = new Set();
    for (const block of blocks) {
      if (notPosts.has(block) || block.closest(`[${POST_MARK}], .hl-bar, .hl-honest, header, nav, aside, [role='dialog']`)) {
        continue;
      }
      if (textLen(hoistText(block)) < MIN_DISCOVERY_LENGTH) continue;
      let post = null;
      for (let a = block.parentElement, depth = 0; a && a !== scope && depth < 30; a = a.parentElement, depth++) {
        if (a.querySelector(PROFILE_LINK) && a.querySelectorAll("button").length >= MIN_POST_BUTTONS) {
          post = a;
          break;
        }
      }
      if (post) {
        post.setAttribute(POST_MARK, "");
        posts.add(post);
      } else {
        notPosts.add(block);
      }
    }
    return posts;
  }

  function findTextEl(post) {
    for (const sel of TEXT_SELECTORS) {
      for (const el of post.querySelectorAll(sel)) {
        if (el.closest(EXCLUDE_ANCESTORS)) continue;
        // Text in a list item nested inside the post is a comment.
        if (post.getAttribute("role") === "listitem" && el.closest("[role='listitem']") !== post) continue;
        if (readText(el).length >= MIN_TEXT_LENGTH) {
          // Prefer the wrapper that also holds the "see more" toggle (old
          // layout) or the paragraph around the text (new layout), so hiding
          // it hides everything.
          return (
            el.closest(".feed-shared-inline-show-more-text") ||
            (el.parentElement?.tagName === "P" ? el.parentElement : el)
          );
        }
      }
    }
    // Current feed: no text box yet means the text hasn't loaded; wait for it.
    if (post.getAttribute("role") === "listitem") return null;
    // Fallback: the longest text block that isn't a comment, a link (the
    // author's name and headline are links) or a button.
    let best = null;
    let bestLen = MIN_TEXT_LENGTH - 1;
    const walker = document.createTreeWalker(post, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n; (n = walker.nextNode()); ) {
      const block = blockOf(n.parentElement);
      if (!block || seen.has(block) || block === post) continue;
      seen.add(block);
      // Mention links inside the text are fine; a block that is itself inside a link is not.
      if (block.closest(EXCLUDE_ANCESTORS) || block.closest("a, button")) continue;
      const el = hoistText(block, post);
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

  // Empty copy of an element and its single-child wrappers (e.g. <p><span>),
  // keeping tags, classes and styles but none of the identifying attributes.
  function shellLike(el) {
    const strip = (n) => {
      for (const attr of ["id", "data-testid", "componentkey", "data-urn", "data-id", "dir", "tabindex"]) {
        n.removeAttribute(attr);
      }
      n.classList.remove("hl-hidden", "hl-translating");
      n.style.removeProperty("--hl-ink");
      n.style.removeProperty("--hl-ink-full");
      return n;
    };
    const outer = strip(el ? el.cloneNode(false) : document.createElement("div"));
    let inner = outer;
    for (let src = el; src && src.children.length === 1 && textLen(src.children[0]) >= textLen(src) - 2; ) {
      src = src.children[0];
      const copy = strip(src.cloneNode(false));
      inner.append(copy);
      inner = copy;
    }
    // Keep the text in its own element so the label can sit above it.
    if (inner === outer) inner = outer.appendChild(document.createElement("span"));
    return { outer, inner };
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
      // Dress the translation exactly like the post text: copy the original
      // paragraph's tags and classes (not its content).
      const { outer, inner } = shellLike(textEl);
      const label = document.createElement("span");
      label.className = "hl-label";
      label.textContent = "What they actually mean";
      inner.classList.add("hl-text");
      // One span per word so the reveal animation can stagger them.
      const parts = st.honest.split(/(\s+)/);
      const words = parts.filter((p) => p && !/^\s+$/.test(p)).length;
      const step = Math.min(30, 900 / Math.max(words, 1));
      let i = 0;
      for (const part of parts) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          inner.append(part);
        } else {
          const w = document.createElement("span");
          w.className = "hl-w";
          w.style.animationDelay = `${Math.round(120 + i++ * step)}ms`;
          w.textContent = part;
          inner.append(w);
        }
      }
      outer.prepend(label);
      honestEl.append(outer);
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
    if (textEl) {
      textEl.classList.toggle("hl-hidden", st.view === "honest");
      // Shimmer over the original lines while waiting, Telegram-style. The
      // gradient is built from the text's own colour so it suits both themes.
      if (st.view === "loading" && !textEl.classList.contains("hl-translating")) {
        const m = getComputedStyle(textEl).color.match(/[\d.]+/g) || [0, 0, 0];
        textEl.style.setProperty("--hl-ink", `rgba(${m[0]}, ${m[1]}, ${m[2]}, 0.3)`);
        textEl.style.setProperty("--hl-ink-full", `rgb(${m[0]}, ${m[1]}, ${m[2]})`);
      }
      textEl.classList.toggle("hl-translating", st.view === "loading");
    }
  }

  // ------------------------------------------------------------- animation

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

  // Smoothly resize `el` from the height the previous view had.
  function growFrom(el, fromHeight, duration = 380) {
    if (reducedMotion.matches || !el?.isConnected || !fromHeight) return;
    const to = el.getBoundingClientRect().height;
    if (Math.abs(to - fromHeight) < 2) return;
    const overflow = el.style.overflow;
    el.style.overflow = "hidden";
    el.animate([{ height: `${fromHeight}px` }, { height: `${to}px` }], { duration, easing: EASE }).finished.finally(
      () => (el.style.overflow = overflow),
    );
  }

  // Swap views with the height morph + staggered word reveal.
  function transition(post, nextView) {
    const st = getState(post);
    const from =
      st.view === "honest" ? st.honestEl?.getBoundingClientRect().height : st.textEl?.getBoundingClientRect().height;
    st.view = nextView;
    render(post);
    if (nextView === "honest") {
      if (!reducedMotion.matches) {
        st.honestEl.classList.add("hl-animate");
        clearTimeout(st.animTimer);
        st.animTimer = setTimeout(() => st.honestEl.classList.remove("hl-animate"), 1600);
      }
      growFrom(st.honestEl, from);
    } else if (nextView === "original" && st.textEl) {
      growFrom(st.textEl, from, 320);
      if (!reducedMotion.matches) {
        st.textEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease-out" });
      }
    }
  }

  function onButton(post) {
    const st = getState(post);
    st.userChose = true;
    if (st.view === "honest") {
      transition(post, "original");
    } else if (st.honest) {
      transition(post, "honest"); // already paid for this one
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
      if (st.view === "loading") transition(post, "honest");
      else render(post);
    } catch (e) {
      st.error = e.message || String(e);
      st.view = "error";
      render(post);
    }
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
      st.textEl?.classList.remove("hl-hidden", "hl-translating");

    }
    states.clear();
    document.querySelectorAll(`[${POST_MARK}]`).forEach((el) => el.removeAttribute(POST_MARK));
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
