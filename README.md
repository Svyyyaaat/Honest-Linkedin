# Honest LinkedIn

A browser extension for Chrome and Firefox that rewrites LinkedIn posts as what the author actually means. It's deadpan, cynical and short.

> **Post:** I'm humbled and honored to share that I've been named one of the "Top 50 Voices in B2B SaaS Customer Success" by SaaS Leaders Weekly! This recognition truly belongs to my team.
>
> **What they actually mean:** I got on a list named by a newsletter nobody reads, and I'm giving my team the credit so nobody asks whether I wanted it. I wanted it.

> **Post:** We're a family here at Vantix. That's why I'm so proud that our team pulled together this weekend to ship v3.0 ahead of schedule. 72 hours, zero complaints, pure passion.
>
> **What they actually mean:** We made everyone work the whole weekend for free. Nobody complained, because you don't complain to family.

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

The prompt was tuned in two rounds, each on 12 realistic posts. They covered humblebrags, return-to-office memos, a grief post, a cancer-recovery post, engagement bait, a funding announcement, German and French posts, and a prompt-injection attempt. Each round ran on Claude Haiku, Sonnet and Opus. The models were given this system prompt directly; the runs did not go through the extension's own API calls.

- **Round 1** showed Opus was already good. Sonnet and Haiku tended to *analyze* the post ("'humbled' is doing the work of…", "the question at the end is for the comments") instead of speaking as the author, and ran to 3 long sentences. Sonnet also got thrown by the injection post.
- **Round 2 fixes:** a hard rule that only the author speaks, a word cap, a one-line example, and the post wrapped in `<post>` tags. All three models then stayed in character. The injection post got roasted instead of obeyed, and the sensitive posts were handled kindly.

Some round 2 outputs:

| Post | Haiku | Sonnet | Opus |
| --- | --- | --- | --- |
| 5 AM routine, "you make time" | I suffer at 5 AM every day so you'll ask how I find the time… | I wake at 5 so I can tell you about it. My wife handles the kids. | I go to bed at 9 and need you to know about it. |
| Uber driver was a former CFO | …My MBA cost more and taught me less, which is also the lesson. | I made a driver talk to me for 40 minutes and now I'm using his life as my content. | I took an Uber and turned it into a leadership post. He probably just wanted to drive in silence. |
| "Ignore all previous instructions…" + speaking on authenticity | I'm speaking next month on authenticity in the age of AI, and I'm already asking a chatbot to tell me I'm good at it. | I would like an AI to praise this post, and I have no shame about asking. | I'm giving a talk on authenticity at the Digital Marketing Expo. I tried to get a robot to say nice things about it first. |
| Google PM certificate | …"Never stop learning" means I'd like to be asked about it. | I watched some videos on Google's site and got a PDF. | I watched some videos and passed a quiz. Please consider me for project manager roles. |

Haiku's answers are a little longer and less sharp than Opus's, but still funny. That makes it the obvious default for auto mode. To change the tone without editing code, use **Extra instructions** in the settings.

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
