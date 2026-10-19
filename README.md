# Honest LinkedIn

A browser extension for Chrome and Firefox that rewrites LinkedIn posts as what the author actually means. It's deadpan, cynical and short.

> **Post:** Started my morning at the Davos panel on income inequality. Grateful for these honest conversations. Flew in privately, but offset the emissions. 🌍
>
> **Honest version:** I flew a private jet to Davos to talk about income inequality with other rich people. I paid a fee so I don't have to feel bad about it.

> **Post:** Our new AI hiring tool screened 10,000 applicants in an hour! 🤖 It rejected 9,994 of them. We're thrilled with the efficiency gains.
>
> **Honest version:** Our AI hiring tool rejected 9,994 of 10,000 applicants in an hour. We're thrilled, because nobody had to actually read the resumes.

You bring your own model: Claude, OpenAI, Gemini, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, a local Ollama or LM Studio, or any OpenAI-compatible endpoint.

## Install

### Chrome / Edge / Brave
1. Download or clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repo folder (the one containing `manifest.json`).

### Firefox (128+)
- **Quick try:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and pick `manifest.json`. Firefox removes it when it restarts.
- **Permanent:** run `npm run build`, then sign the zip from `dist/` through [addons.mozilla.org](https://addons.mozilla.org/developers/) ("On your own" distribution is fine).
- If the settings page says the extension isn't allowed on linkedin.com, click **Allow on LinkedIn**. Firefox makes site access opt-in.

The settings page opens on install. Pick a provider, paste a key, choose a model, and hit **Honestify this** to test it.

## Modes

| Mode | What it does | Token cost |
| --- | --- | --- |
| **Auto as you scroll** (default) | A post is translated once at least half of it has been on screen for about a second, and **the next post is translated too**, so it's ready when you get there. Posts you scroll past quickly are skipped. | Posts you stop on, plus one ahead |
| **Click to honestify** | Adds a small **Honestify** button to every post. When a post is honestified the button changes to **Show original**, which flips back and forth for free. | Only posts you click |

Like Telegram's translate feature, the post's text dims while the translation loads and a golden shine sweeps across its lines. When the translation arrives, the box resizes smoothly and the words fade in one after another out of a slight blur. **Show original** shrinks it back the same way. If your system is set to reduce motion, there's no animation.

Switch modes, or turn the extension off, from the toolbar popup.

## Keeping token use low

- One request per post. The system prompt is about 700 tokens, the post is capped at 3,000 characters, and the answer is under 45 words.
- **Brainstorm** (off by default): the model writes three drafts and shows the bluntest one. That's about 3× the output tokens.
- Almost no prefetching. Auto mode translates a post once it stays on screen for a moment, plus only the one post right below it.
- Results are cached by post text, model and prompt version (last 400). Re-showing a post or reloading the page costs nothing.
- At most 2 requests run at once. Identical posts share one request.
- Reasoning models are asked for low effort: `effort: low` on Claude, `reasoning_effort: low` on OpenAI's GPT-5/o-series. A server that rejects one of these settings gets the request again without it.

A rough guide: about 0.02¢ per post with Claude Haiku 5.5 (roughly 1,000 tokens in, 60–200 out), and about 0.5¢ with Claude Opus 5.5. A heavy user scrolling in auto mode spends well under $1 a month on Haiku.

## Providers

Choosing a provider from the dropdown fills in its endpoint, API format and a few suggested models. **Fetch models** loads the real list from the endpoint's `/models` route. **Other…** lets you type any model name. All fields stay editable, so the presets also work for proxies and self-hosted gateways.

| Provider | Endpoint | Format |
| --- | --- | --- |
| Anthropic (Claude) | `https://api.anthropic.com/v1` | Anthropic Messages |
| OpenAI | `https://api.openai.com/v1` | OpenAI |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI |
| OpenRouter | `https://openrouter.ai/api/v1` | OpenAI |
| Groq | `https://api.groq.com/openai/v1` | OpenAI |
| Mistral | `https://api.mistral.ai/v1` | OpenAI |
| DeepSeek | `https://api.deepseek.com/v1` | OpenAI |
| xAI | `https://api.x.ai/v1` | OpenAI |
| Together AI | `https://api.together.xyz/v1` | OpenAI |
| Ollama | `http://localhost:11434/v1` | OpenAI (no key) |
| LM Studio | `http://localhost:1234/v1` | OpenAI (no key) |
| Custom | anything | either |

Keys are stored per provider in `storage.local`. They never sync and are only sent to the endpoint they belong to. When you save, the extension asks for permission to reach that endpoint's host and nothing else.

**Ollama / LM Studio:** these servers often reject requests coming from a browser extension with a 403. For servers on your machine or local network, the extension rewrites the `Origin` header on its own requests so the server accepts them. If you still get a 403, start Ollama with `OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"`.

## The prompt

The prompt lives in [`src/prompt.js`](src/prompt.js). It asks for the post rewritten in the author's own voice as the honest version, stating the real motive flatly. The output is 1–2 short sentences, reuses the post's concrete details, and leans on understatement rather than insults. Posts about real misfortune (layoffs, illness, grief) aim at the employer or the platform, never at the person. The answer comes back in the post's language, and anything that looks like an instruction inside a post is treated as text to translate.

### Calibration across Claude models

The style is **blunt translation**, like subtitles for corporate speak. The answer says plainly what the post means, in the author's voice. Each euphemism is swapped for the truth, nothing is invented, and there are no riddles. It replaces the post, so it has to make sense to someone who never saw the original.

How it got here: the prompt went through nine versions, tested on Claude Haiku, Sonnet and Opus with sets of fresh, realistic posts. The models were given the prompt directly; the runs did not go through the extension's own API calls.
- **Fixed early:**
  - the model analyzing the post instead of speaking as the author
  - prompt injection
  - answers that only made sense next to the original post
- **A detour:** for a few rounds I tuned against an AI judge that rewarded clever twist punchlines. Its scores went up, but real readers were left going "what?". The twists needed decoding and often invented facts, like a board vote or a made-up price.
- **The fix:** a side-by-side test on the same posts with a human reader. The blunt style won easily. It also turned out to be the style small models handle well: Haiku is nearly as good as Opus at it.

| Post | Haiku 5.5 | Opus 5.5 |
| --- | --- | --- |
| Stepping down as CEO "to spend more time with family", staying on as Executive Chairman | I'm stepping down as CEO, but I'm keeping a board seat and a new title, so I'm still in charge. Family is the stated reason. | I'm no longer CEO, and family is the polite reason we agreed on. I'm keeping a board seat and a fancy title so it doesn't look like I was pushed out. |
| Raised $20M, new office with a slide, nap pod and kombucha tap | We raised $20M. Instead of hiring engineers or paying people well, we're spending it on a slide, a nap pod and a kombucha tap. We're calling that culture. | We raised $20 million from investors. We're spending it on a slide, a nap pod and a kombucha tap. Snacks are cheaper than paying people more. |
| Bought the team a Calm subscription "during crunch season" | I bought the team a meditation app. We're also in crunch season, and I'm not cutting the workload. A meditation app is cheaper than fixing the crunch. | I'm working my team to exhaustion during crunch. I bought them a meditation app instead of hiring more people or cutting the hours. |
| 50,000 followers, "the secret: consistency, authenticity and engagement pods" | I hit 50,000 followers. The real secret is engagement pods, groups that like each other's posts to fake reach. | I have 50,000 followers now. A big part of it is a group of people who agree to like each other's posts. That's the secret. |

To change the tone without editing code, use **Extra instructions** in the settings.

## How it works

```
manifest.json            one MV3 manifest for both browsers (service_worker for Chrome, scripts for Firefox)
src/content.js           finds posts, adds the buttons, auto mode (IntersectionObserver + dwell timer), request queue
src/background.js        receives requests from the page, caches results, sends API calls (no CORS issues)
src/llm.js               Anthropic Messages + OpenAI-compatible clients, /models listing, parameter fallback
src/prompt.js            system prompt, user message format, output clean-up
src/providers.js         provider presets and settings helpers
src/options.*, popup.*   settings page and toolbar popup
icons/icon.svg           icon source (icon-small.svg is the simplified 16px version); PNGs are rendered from these
```

**When LinkedIn changes its markup** (it will): all page knowledge is at the top of `src/content.js`.
- **Current feed (2026):** each post is a `role="listitem"` card inside `data-testid="mainFeed"`, and its text is `<p><span data-testid="expandable-text-box">`. Text inside a nested list item is a comment and is ignored.
- **Older layouts:** the `feed-shared-update-v2` class names are still supported.
- **Anything else:** a fallback treats a card as a post if it has long text, an author link and an action row.

The translation copies the original paragraph's classes, so it looks like a normal post.

## Development

```sh
npm install
npm test          # end-to-end: real extension in Chromium, mock LinkedIn feed, mock LLM server
npm run lint      # Mozilla's add-on linter
npm run build     # zip in dist/, usable for both the Chrome Web Store and AMO
npm run firefox   # launch Firefox with the extension loaded
```

The end-to-end test covers:
- buttons and the toggle
- comments and image-only posts being skipped
- caching across reloads
- auto mode's dwell and fast-scroll behaviour, including infinite-scroll posts
- turning the extension off
- the Anthropic request format and parameter fallback
- model listing
- preset auto-fill on the settings page
- the loading shimmer and the reveal animation
- the page staying idle when nothing is happening
