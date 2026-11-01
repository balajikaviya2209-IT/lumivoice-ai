# Lumi AI (hosted app)

Chat, a voice assistant with a "Hi Lumi" wake word, voice shortcuts to YouTube, Spotify, Google, Maps, calls and texts, permission-based file access, and a photo editor. The app is static files on Netlify, and a small Netlify Function relays chat to Anthropic, so your API key never reaches the phone.

    netlify.toml                    Netlify settings and security headers
    netlify/functions/chat.mjs      the chat relay, answers POST /api/chat
    package.json                    no dependencies, Node 18+
    .env.example                    settings to copy
    public/                         the app (index.html, voice.js, files.js, apps.js, manifest.webmanifest, sw.js, icons/)

## Put it online on Netlify
It must be served over HTTPS (Netlify does this), or the microphone and speech features will not work.

Functions do not run with Netlify's plain drag-and-drop upload, so use one of these:

1. **Git (recommended):** put this folder in a GitHub repo, then in Netlify choose Add new project > Import an existing project and pick the repo. Leave the build command empty. Netlify reads `netlify.toml` for the rest.
2. **CLI:** `npm i -g netlify-cli`, then `netlify login` and `netlify deploy --prod` from this folder.

Then, in Netlify under Site configuration > Environment variables, add `ANTHROPIC_API_KEY` and `APP_PASSCODE` (and any other value from `.env.example`). Redeploy once after adding them.

Open the URL on your phone, then Share > Add to Home Screen (iPhone) or Install app (Android).

To test on your computer: `npm i -g netlify-cli`, copy `.env.example` to `.env`, fill it in, run `netlify dev`.

## Keep your API credit safe
- Set `APP_PASSCODE`. The app asks for it once on your phone and remembers it. Without it, anyone who finds your URL can spend your credit.
- Keep the API key only in Netlify's environment variables. Never put it in `public/` or commit `.env`.
- The function also limits each IP to `RATE_LIMIT_PER_MIN` requests a minute and the whole app to `DAILY_LIMIT` a day. On Netlify these counters live in memory and reset when the function goes idle, so they are approximate. The passcode and your Anthropic spend limit are what really protect you.
- Set a monthly spend limit in your Anthropic console as a final backstop.
- The function does not log what you say or what Lumi answers.

## Controlling other apps
A web page cannot press buttons inside other apps or place calls by itself. What it can do is open links, which your phone hands to the installed app. Lumi turns your voice into those links. Say them after "Hi Lumi", or tap the orb first.

| Say | What happens |
|---|---|
| "Play lo-fi beats on YouTube", "open YouTube" | Opens YouTube search results (or the home page) |
| "Play The Weeknd on Spotify" | Opens Spotify search results. You tap play; Spotify does not let web pages start a song |
| "Search Google for pizza near me", "Google weather in Delhi" | Opens Google results |
| "Navigate to the airport" | Opens turn-by-turn directions in Maps |
| "Call Mom", "call 98765 43210" | Shows a Call button. One tap dials |
| "Text Dad saying I'm late", "WhatsApp Priya saying happy birthday" | Shows a Review & send button that opens the message ready to send |
| "Open Netflix / Instagram / Gmail / WhatsApp" | Opens the app or site |
| "Play despacito" | With no app named, opens a YouTube search |

Limits you should know about:
- Calls and messages always need your tap. The browser also usually blocks launching other apps without a tap, so for most commands Lumi shows a button for you to press. If the phone allows it, it opens the app straight away.
- Lumi cannot read your screen, skip songs, pause videos, answer calls or set alarms.
- Names for "call Mom" come from the Contacts list in the Voice tab. They stay on your phone. Add them by hand, or tap Import from phone where the browser supports it (Chrome on Android).
- Save numbers with the country code (+91..., +1...) so WhatsApp links work.
- Commands are matched in English for now.

## Voice, wake word, files, editor
- Voice tab: tap the orb, or turn on "Say Hi Lumi". The wake word only works while the app is open with the screen on, uses your browser's speech service (audio goes to its vendor), and a red badge shows when the microphone is live.
- "Only my voice" learns your voice from four phrases and ignores others. It is a convenience filter, not security. It was only tested on simulated voices.
- Files (+ in Chat): choose files, or in Chrome/Edge give read-only access to a folder. Images open in the editor and text files attach to your next message.
- Editor: tap an object to remove it, adjust light and colour, apply filters. Photos are scaled to 1600 px.

## Settings
`ANTHROPIC_MODEL` defaults to `claude-sonnet-5-5`. Check Anthropic's docs for current model names and change it if you want something faster or cheaper. Replies are not streamed yet, so long answers appear all at once.

After changing any file in `public/`, bump `VERSION` in `public/sw.js` so installed copies update.
