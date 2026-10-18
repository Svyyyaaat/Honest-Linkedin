# Honest LinkedIn

A browser extension for Chrome and Firefox that rewrites LinkedIn posts as what the author actually means. It's deadpan, cynical and short.

> **Post:** I turned down a $400K offer from Meta last week. People think I'm crazy. But money isn't everything. Alignment with your values is. Here's what I learned 🧵
>
> **What they actually mean:** Meta didn't make me an offer. A recruiter sent me a salary range once.

> **Post:** Our office is reopening 5 days a week starting January. Magic happens when we're together. Culture can't be built over Zoom. — CEO
>
> **What they actually mean:** We signed a ten-year lease on this building. Some of you will quit instead of commuting, which saves me a layoff.

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
| **Click to honestify** (default) | Adds a small **Honestify** button to every post. When a post is honestified the button changes to **Show original**, which flips back and forth for free. | Only posts you click |
| **Auto as you scroll** | A post is translated once at least half of it has been on screen for about a second. Posts you scroll past quickly are skipped, and nothing is fetched ahead. | Only posts you stop on |

Like Telegram's translate feature, the post's text dims while the translation loads and a golden shine sweeps across its lines. When the translation arrives, the box resizes smoothly and the words fade in one after another out of a slight blur. **Show original** shrinks it back the same way. If your system is set to reduce motion, there's no animation.

Switch modes, or turn the extension off, from the toolbar popup.

## Keeping token use low

- One short request per post: the system prompt is about 600 tokens, the post is capped at 3,000 characters, and the answer is under 40 words.
- No prefetching. Auto mode needs a post to stay on screen for a moment.
- Results are cached by post text, model and prompt version (last 400). Re-showing a post or reloading the page costs nothing.
- At most 2 requests run at once. Identical posts share one request.
- Reasoning models are asked for low effort: `effort: low` on Claude, `reasoning_effort: low` on OpenAI's GPT-5/o-series. A server that rejects one of these settings gets the request again without it.

A rough guide: with Claude Haiku 5.5 a translation costs about a hundredth of a cent.

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

**Ollama:** recent versions accept requests from browser extensions as-is. If you get a 403, start Ollama with `OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"`.

## The prompt

The prompt lives in [`src/prompt.js`](src/prompt.js). It asks for the post rewritten in the author's own voice as the honest version, stating the real motive flatly. The output is 1–2 short sentences, reuses the post's concrete details, and leans on understatement rather than insults. Posts about real misfortune (layoffs, illness, grief) aim at the employer or the platform, never at the person. The answer comes back in the post's language, and anything that looks like an instruction inside a post is treated as text to translate.

### Calibration across Claude models

The prompt went through three versions. Each was tested on Claude Haiku, Sonnet and Opus with sets of 12 realistic posts: humblebrags, return-to-office memos, layoffs, a grief post, engagement bait, a funding round, posts in German, French and Spanish, and a prompt-injection attempt. The models were given the system prompt directly; the runs did not go through the extension's own API calls.

- **v1:** Sonnet and Haiku tended to *analyze* the post ("'humbled' is doing the work of…") instead of speaking as the author. Sonnet also followed the injected instruction.
- **v2:** a strict "only the author speaks" rule and the post wrapped in `<post>` tags. This fixed both problems, but the answers settled into a flat formula, "I did X. I'm posting this so Y." That's accurate but not funny.
- **v3 (current):** the prompt now asks for *one* damning truth that ends on a turn, translates corporate phrases into plain meaning, bans recapping the post and the X/Y formula, and uses examples with varied punchline shapes. A judge that didn't know which prompt wrote which answer preferred v3 over v2 in **17 of 24** head-to-head pairs (Haiku 9–3, Sonnet 8–4).

v3 on the same posts:

| Post | Haiku | Opus |
| --- | --- | --- |
| "After 6 wonderful years… time to explore what's next" | Six years, and exploring what's next is the only exit they offered. The gratitude was free. | I was asked to leave Fintrix. More to share as soon as someone hires me. |
| Turned down $400K from Meta, "values" | I turned down Meta's $400K to see if my current company would match it. They went up $15K, and I'm calling it values. | Meta didn't make me an offer. A recruiter sent me a salary range once. |
| 10-day silent retreat → 12 lessons for founders | Ten days without a phone, and the first thing I did was draft twelve lessons for a thread. | I didn't talk for ten days and came back with twelve tips for founders. The silence clearly didn't take. |
| Uber driver was a former CFO | Titles are temporary, which is why he's driving an Uber now. | …my takeaway was a quote about humility. I tipped him in lessons. |
| CEO: "40% of my team impacted… if you're hiring, they're incredible" | Forty percent of them, one Zoom call, and now I need you to hire them. | I laid off 40% of my team. I'd like you to hire them, and I'd like you to notice how sad I am. |

Opus is the sharpest. Haiku is funny and cheap, which makes it a good default for auto mode. Sonnet is somewhere in between and sometimes over-explains. To change the tone without editing code, use **Extra instructions** in the settings.

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

**When LinkedIn changes its markup** (it will): every selector is at the top of `src/content.js` (`POST_SELECTORS`, `TEXT_SELECTORS`, `EXCLUDE_ANCESTORS`). If none of them match, it falls back to the longest text block in the post that isn't a comment.

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
