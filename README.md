# Split-Flap

A Vestaboard-style split-flap display that runs on `localhost`, built to be pinned
as a live macOS desktop wallpaper with [Plash](https://sindresorhus.com/plash).

A 22 × 6 board of mechanically-flipping characters (plus the 8 Vestaboard color
chips) shows one **main source** — weather, quote of the day, Hacker News, or a
crypto price — and any **message integration** (Telegram / Discord / Slack / a
custom message from the settings page) interrupts the board for 60 seconds
before it flips back.

## Run it

```bash
npm install
npm start        # builds the frontend, then serves everything on http://localhost:3000
```

For development with hot reload:

```bash
npm run dev      # backend on :3000, Vite dev server on :5173
```

## Point Plash at it

1. Install Plash from the Mac App Store.
2. `npm start` (keep it running — e.g. in a background terminal, or add it as a
   Login Item / launchd job).
3. Plash menu-bar icon → **Add Website…** → `http://localhost:3000`.
4. In Plash, enable **Browsing Mode** briefly whenever you want to click the
   gear icon and change settings — or just open `http://localhost:3000/settings`
   in a normal browser.

The board fills the viewport edge-to-edge with no scrollbars. The gear icon
auto-hides after 5 seconds without mouse movement and comes back on hover.

## Settings (`/settings`)

- **Main source** (single select): Weather (Open-Meteo), Quote of the Day
  (ZenQuotes), News (Hacker News), Crypto (CoinGecko). All keyless. A refresh
  interval (default 5 min) controls how often it re-fetches.
- **Message integrations** (any combination):
  - **Telegram** — paste a bot token from @BotFather. The backend long-polls
    `getUpdates`, so no public URL is required. DM your bot and the message
    appears on the board.
  - **Discord** — bot token + channel ID. Uses a gateway connection. Enable the
    *Message Content* intent in the Discord developer portal.
  - **Slack** — bot token (`xoxb-…`) + app-level token (`xapp-…`) with Socket
    Mode enabled and message events subscribed.
  - **Custom message** — type anything, it shows for 60 seconds.
- Messages support color chips inline: `{red} {orange} {yellow} {green} {blue}
  {violet} {white} {black}`.

Tokens are stored server-side in `data/config.json` (gitignored) and are never
sent back to the browser in full — the API masks them.

## Behavior

- New message → board flips to it immediately (WebSocket push) for 60 s.
- A second message resets the 60 s window; newest always wins.
- After expiry the board flips back to the cached main-source content.
- Everything (selection, tokens, interval) persists across restarts.
