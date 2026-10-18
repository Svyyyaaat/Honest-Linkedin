# Honest LinkedIn

A browser extension for Chrome and Firefox that rewrites LinkedIn posts as what the author actually means. It's deadpan, cynical and short.

> **Post:** Our intern just saved the company $2M by noticing a billing error nobody caught for 3 years. We're giving her a $50 Amazon gift card and a shoutout. This is what recognition looks like! 🙌
>
> **Honest version:** Our intern found a $2M billing error. We gave her a $50 gift card. That's a 0.0025% commission.

> **Post:** We fired our top salesperson today. He hit 180% of quota, but he was toxic to our culture. Culture eats strategy for breakfast. Every time.
>
> **Honest version:** We fired our top salesperson, who hit 180% of quota. Toxic means he asked where his commission was.

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

The translation **replaces** the post, so it has to work for a reader who never sees the original. Each answer has two parts:
- a short setup that says plainly what was posted, with the one key detail
- one or two short sentences with the honest twist

The whole thing is under 35 words.

The prompt went through five versions. Each was tested on Claude Haiku, Sonnet and Opus using sets of 10–12 realistic posts: humblebrags, return-to-office memos, layoffs, grief, engagement bait, funding rounds, posts in German, French and Spanish, and a prompt-injection attempt. The models were given the system prompt directly; the runs did not go through the extension's own API calls. Versions were compared blind, by a judge that didn't know which prompt wrote which answer.

| Version | Change | Result |
| --- | --- | --- |
| v1 | Basic brief + examples | Haiku and Sonnet *analyzed* the post instead of speaking as the author. Sonnet followed the injected instruction. |
| v2 | "Only the author speaks", post wrapped in `<post>` tags | Fixed both, but answers settled into a flat "I did X. I'm posting this so Y." |
| v3 | Ask for one punchline with a turn; ban recapping and the X/Y formula | Preferred over v2 in 17 of 24 blind pairs. But many lines only made sense next to the original ("The silence clearly didn't take."). |
| v4 | Must work on its own: say what was posted, then the twist | Always understandable, but Haiku and Sonnet retold the whole post and explained the joke. |
| **v5** | Strict shape: one-sentence setup, short punchline, under 15 words per sentence, never explain | **Judged without seeing the posts:** as funny as v3 (9 wins to 11, a tie), and understandable on its own in 10 of 10 cases. v3 managed 7 of 10. |

v5 on posts no version was tuned on:

| Post | Haiku | Opus |
| --- | --- | --- |
| Joined the Forbes Business Council | I paid to join the Forbes Business Council. The thought leadership is the receipt. | I joined the Forbes Business Council. It's a paid membership. The honor cost about $2,000 a year. |
| Startup acquired by Oracle, "never about the money" | We sold the startup to Oracle. The mission was the money, and the money is under NDA. | Oracle bought our startup. It was all about the money. The product gets shut down in March. |
| Read 100 books this year, "leaders are readers" | I finished my 100th book this year. Most were summaries I played at 2x while doing the dishes. | I read 100 books this year. Mostly the summaries. Atomic Habits counted twice. |
| Raises frozen, "compensation isn't just money" | I told my team we're freezing raises. Compensation isn't just money, and the money is staying in the budget. | I told my team there are no raises this year. I offered them growth instead. My bonus went through as usual. |
| Rejected as "overqualified", choosing to see it as a compliment | I was rejected from my dream job for being overqualified. Overqualified means I'd cost more than the salary they posted. | My dream job rejected me for being overqualified. That means too expensive. I'm taking it as a compliment because rent is due. |

Opus is the sharpest. Haiku is close behind and very cheap, which makes it a good default for auto mode. Sonnet sometimes ends on a limp extra sentence. To change the tone without editing code, use **Extra instructions** in the settings.

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
