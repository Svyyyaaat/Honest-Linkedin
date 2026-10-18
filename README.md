# Honest LinkedIn

A browser extension for Chrome and Firefox that rewrites LinkedIn posts as what the author actually means. It's deadpan, cynical and short.

> **Post:** Started my morning at the Davos panel on income inequality. Grateful for these honest conversations. Flew in privately, but offset the emissions. 🌍
>
> **Honest version:** I spent my morning at the Davos panel on income inequality, after flying in privately. Nobody on the panel earns under $2 million. We agreed it's a problem.

> **Post:** Excited to announce I'm stepping down as CEO to spend more time with my family. I'll remain on the board as Executive Chairman.
>
> **Honest version:** I'm stepping down as CEO to spend time with family, staying on as Executive Chairman. The board voted 6 to 1. The 1 was me.

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

- One request per post. The system prompt is about 800 tokens, the post is capped at 3,000 characters, and the answer is under 35 words.
- **Brainstorm** (on by default, can be turned off in settings): the model writes three drafts and only the funniest is shown. That's about 3× the output tokens (roughly 200 instead of 60), and it made a clear difference for small models.
- No prefetching. Auto mode needs a post to stay on screen for a moment.
- Results are cached by post text, model and prompt version (last 400). Re-showing a post or reloading the page costs nothing.
- At most 2 requests run at once. Identical posts share one request.
- Reasoning models are asked for low effort: `effort: low` on Claude, `reasoning_effort: low` on OpenAI's GPT-5/o-series. A server that rejects one of these settings gets the request again without it.

A rough guide, with brainstorming on: about 0.025¢ per post with Claude Haiku 5.5, and about 1¢ with Claude Opus 5.5.

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

The translation **replaces** the post, so it has to work for a reader who never sees the original, and it has to be an actual joke.

The prompt went through eight versions over seven test rounds, on Claude Haiku, Sonnet and Opus. Every round after the first two used a **new set of 10–12 posts no earlier version had been tuned on**. The sets covered humblebrags, layoffs, grief, return-to-office memos, AI hype, engagement bait, posts in German, French and Spanish, and a prompt-injection attempt.

The models were given the system prompt directly; the runs did not go through the extension's own API calls. A strict judge saw only the translations, never the original posts or which version wrote what. It rated each one 1–5 for funny (4 is a real laugh) and checked whether it made sense on its own.

| Version | Change | What happened |
| --- | --- | --- |
| v1–v2 | Basic brief → "only the author speaks", post in `<post>` tags | Fixed post analysis and prompt injection, but settled into flat "I did X. I'm posting so Y." |
| v3 | One punchline with a turn | Preferred over v2 in 17 of 24 blind pairs, but often only made sense next to the original |
| v4–v5 | Must work on its own: short setup + punchline | Understandable 10 of 10 times, vs 7 of 10 for v3. Haiku scored **2.1/5**: it stated the cynical point instead of showing it. |
| v6 | Joke techniques + "brainstorm 3, pick 1" | Haiku 2.2 → **2.7** with brainstorming |
| v7 | **Show, don't tell**: the punchline is a concrete fact, number or scene, never the moral | Haiku with brainstorming: **3.2**, against 2.4 for v6 on the same posts |
| **v8** | One joke only, no stacked jabs | Same Haiku scores (within noise). Opus is the best yet: **3.6/5, with 7 of 12 getting a real laugh**. |

Where it stands (v8, with the brainstorm setting as shipped):

- **Opus 5.5:** consistently funny, with about half the posts getting a real laugh. *"The board voted 6 to 1. The 1 was me."* · *"Our company has 47 Vice Presidents. It has 31 employees."* · *"Our runway was 30 months. The slide made it 22."*
- **Sonnet 5.5:** ~2.8–2.9. Solid, occasionally great (*"Q4 me just updated his resume."*).
- **Haiku 5.5:** ~2.5–3.2, depending on the batch. It has some genuinely good lines, such as *"Sorting the cans took 20 minutes. The team photo took 40."*, *"The satisfaction survey was sent by the chatbot. It gave itself five stars."* and *"The offset cost $40. The jet cost $80,000."* But it's hit-and-miss, and the last two prompt changes stopped improving it. Brainstorming matters most for Haiku.

Every answer made sense without the original in the last two rounds, apart from one Haiku line in round 7.

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
