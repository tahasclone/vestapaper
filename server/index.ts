import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { getConfig, publicConfig, saveConfig, sanitizePatch } from './config.js';
import { board } from './state.js';
import {
  scheduleMain,
  fetchWeather,
  fetchQuote,
  fetchNews,
  fetchCrypto,
  fetchWord,
  fetchIss,
  fetchPrayer,
  fetchFacts,
  fetchFlights,
} from './integrations/main.js';
import {
  applyMessageConfig,
  testTelegram,
  testDiscord,
  testSlack,
} from './integrations/messages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json());

// ------------------------------------------------------------------ API

app.get('/api/board-state', (_req, res) => {
  res.json(board.get());
});

app.get('/api/config', (_req, res) => {
  res.json(publicConfig());
});

app.post('/api/config', (req, res) => {
  saveConfig(sanitizePatch(req.body));
  scheduleMain();
  void applyMessageConfig();
  res.json(publicConfig());
});

app.post('/api/message', (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Empty message' });
  board.showMessage(text);
  res.json({ ok: true });
});

app.post('/api/test/:integration', async (req, res) => {
  const cfg = getConfig();
  const body = sanitizePatch({ messages: req.body?.messages ?? {} }) as any;
  try {
    let detail = '';
    switch (req.params.integration) {
      case 'weather':
        detail = (await fetchWeather(req.body?.location ?? cfg.main.weather.location)).text;
        break;
      case 'quotes':
        detail = (await fetchQuote()).text;
        break;
      case 'news':
        detail = (await fetchNews()).text.slice(0, 120);
        break;
      case 'crypto':
        detail = (await fetchCrypto(req.body?.coin ?? cfg.main.crypto.coin)).text;
        break;
      case 'word':
        detail = (await fetchWord()).text.slice(0, 120);
        break;
      case 'iss':
        detail = (await fetchIss()).text;
        break;
      case 'prayer':
        detail = (await fetchPrayer(req.body?.prayerLocation ?? cfg.main.prayer.location)).text;
        break;
      case 'facts':
        detail = (await fetchFacts()).text.slice(0, 120);
        break;
      case 'flights':
        detail = (await fetchFlights(req.body?.flightsLocation ?? cfg.main.flights.location)).text;
        break;
      case 'telegram':
        detail = await testTelegram(
          body?.messages?.telegram?.botToken || cfg.messages.telegram.botToken,
        );
        break;
      case 'discord':
        detail = await testDiscord(
          body?.messages?.discord?.botToken || cfg.messages.discord.botToken,
          req.body?.messages?.discord?.channelId ?? cfg.messages.discord.channelId,
        );
        break;
      case 'slack':
        detail = await testSlack(
          body?.messages?.slack?.botToken || cfg.messages.slack.botToken,
          body?.messages?.slack?.appToken || cfg.messages.slack.appToken,
        );
        break;
      default:
        return res.status(404).json({ ok: false, error: 'Unknown integration' });
    }
    res.json({ ok: true, detail });
  } catch (err) {
    res.json({ ok: false, error: (err as Error).message });
  }
});

// ------------------------------------------------------- Static frontend

const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) =>
    res
      .status(200)
      .send('Frontend not built yet. Run "npm run build", or use the Vite dev server on :5173.'),
  );
}

// ------------------------------------------------------------ WebSocket

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'board', state: board.get() }));
});

board.on('change', (state) => {
  const payload = JSON.stringify({ type: 'board', state });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
});

// ----------------------------------------------------------------- Boot

server.listen(PORT, () => {
  console.log(`Split-flap board running at http://localhost:${PORT}`);
  scheduleMain();
  void applyMessageConfig();
});
