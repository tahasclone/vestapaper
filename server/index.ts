import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from './db/migrate.js';
import { one } from './db.js';
import {
  ConfigPatchSchema,
  deepMerge,
  withDefaults,
  MAIN_SOURCES,
  type MainSource,
} from './config.js';
import {
  boardSize,
  createBoard,
  getBoardByToken,
  invalidateBoardCache,
  maybePrune,
  readBoardState,
  rotateToken,
  saveBoardConfig,
  setOverride,
  touchLastSeen,
  type BoardRow,
} from './boardService.js';
import { paramsFromConfig } from './integrations/main.js';
import { getCachedSource } from './integrations/cache.js';
import { PUBLIC_BASE_URL, checkBaseUrl } from './baseUrl.js';
import { byIp, byToken, byUser, rateLimit } from './rateLimit.js';
import { mountHooks } from './hooks.js';
import { mountIntegrationRoutes } from './integrations/routes.js';
import { listForBoard, publicView } from './integrations/store.js';
import {
  googleConfigured,
  loadSession,
  mountAuth,
  requireBoard,
  requireSameOrigin,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const app = express();
// Render terminates TLS upstream, so without this req.ip is the proxy's.
app.set('trust proxy', 1);

// Per-group parsers rather than a global one: /hooks needs the RAW body for
// signature verification, and making that structural beats a verify callback.
app.use('/api', express.json({ limit: '32kb' }));
app.use('/hooks', express.raw({ type: '*/*', limit: '64kb' }));

// 'unsafe-inline' for style is required: cell sizing sets CSS custom
// properties via inline style attributes. Fonts come from Google Fonts.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // no-referrer keeps a board token out of other sites' logs if one is linked.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', CSP);
  next();
});

const POLLUTING_KEYS = /"(__proto__|constructor|prototype)"\s*:/;

/**
 * Reject prototype-polluting payloads outright. deepMerge already skips these
 * keys, but refusing them here makes the guarantee explicit rather than a
 * property of one function nobody will remember to preserve.
 */
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (POLLUTING_KEYS.test(JSON.stringify(req.body ?? null))) {
    return res.status(400).json({ error: 'Malformed request' });
  }
  next();
});

app.get('/healthz', (_req, res) => {
  // Deliberately touches no dependency: a DB-backed check would flap every
  // time Neon resumes from its idle suspend.
  res.type('text').send('ok');
});

// Session first, then the same-origin gate, then the authenticated routes.
app.use(loadSession);
app.use('/api', requireSameOrigin);

// Sign-in is cheap to start but writes an oauth_states row each time.
app.use(
  '/auth/google',
  rateLimit({ name: 'signin', limit: 20, windowMs: 60 * 60_000, key: byIp }),
);
mountAuth(app);
mountHooks(app);
mountIntegrationRoutes(app);

// ------------------------------------------------------- public board API

app.get(
  '/api/b/:token/state',
  rateLimit({ name: 'state', limit: 30, windowMs: 60_000, key: byToken }),
  async (req, res) => {
  void maybePrune();
  const since = Number(req.query.since);
  const state = await readBoardState(req.params.token);
  if (!state) return res.status(404).json({ error: 'No such board' });

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

    if (Number.isFinite(since) && since > 0 && state.revision === since) {
      return res.json({ unchanged: true, revision: state.revision });
    }
    res.json(state);
  },
);

// ------------------------------------------------------------- board admin

app.get('/api/me', requireBoard, async (req, res) => {
  const board = req.board!;
  void touchLastSeen(board.id);
  const integrations = (await listForBoard(board.id)).map(publicView);
  res.json({
    user: {
      email: req.user!.email,
      name: req.user!.name ?? undefined,
      pictureUrl: req.user!.picture_url ?? undefined,
    },
    board: {
      token: board.public_token,
      rows: board.rows,
      cols: board.cols,
      boardUrl: `${PUBLIC_BASE_URL}/b/${board.public_token}`,
    },
    config: withDefaults(board.config),
    integrations,
  });
});

app.post('/api/board/config', requireBoard, async (req, res) => {
  const board = req.board!;
  const parsed = ConfigPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid settings', detail: parsed.error.issues[0]?.message });
  }
  const merged = deepMerge(withDefaults(board.config), parsed.data);
  await saveBoardConfig(board.id, merged);
  res.json({ ok: true, config: merged });
});

app.post(
  '/api/board/message',
  rateLimit({ name: 'message', limit: 20, windowMs: 60_000, key: byUser }),
  requireBoard,
  async (req, res) => {
  const board = req.board!;
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'Empty message' });
  if (text.length > 500) return res.status(400).json({ error: 'Message too long' });
    await setOverride(board.id, text);
    res.json({ ok: true });
  },
);

app.post(
  '/api/board/rotate-token',
  rateLimit({ name: 'rotate', limit: 10, windowMs: 60 * 60_000, key: byUser }),
  requireBoard,
  async (req, res) => {
  const board = req.board!;
    const token = await rotateToken(board.id);
    res.json({ ok: true, token, boardUrl: `${PUBLIC_BASE_URL}/b/${token}` });
  },
);

/**
 * Preview one source without changing what the board shows. Routed through the
 * shared cache so repeated clicks cost nothing upstream.
 */
app.post(
  '/api/board/test/:source',
  rateLimit({ name: 'test', limit: 10, windowMs: 60_000, key: byUser }),
  requireBoard,
  async (req, res) => {
  const board = req.board!;
  const source = req.params.source as MainSource;
  if (!MAIN_SOURCES.includes(source)) {
    return res.status(404).json({ ok: false, error: 'Unknown source' });
  }
  // Validate any overrides the caller passed, then use the board's own config.
  const parsed = ConfigPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid settings' });
  const cfg = deepMerge(withDefaults(board.config), parsed.data);

    try {
      const { text } = await getCachedSource(source, paramsFromConfig(cfg), boardSize(board));
      res.json({ ok: true, detail: text.slice(0, 160) });
    } catch (err) {
      res.json({ ok: false, error: (err as Error).message });
    }
  },
);

// ------------------------------------------------------- static frontend

const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/hooks') ||
      req.path.startsWith('/auth')
    ) {
      return next();
    }
    if (req.path.startsWith('/b/')) {
      res.setHeader('X-Robots-Tag', 'noindex');
      res.setHeader('Cache-Control', 'no-store');
    }
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) =>
    res.status(200).send('Frontend not built. Run "npm run build", or use Vite on :5173.'),
  );
}

// ----------------------------------------------------------------- boot

async function main() {
  checkBaseUrl();
  await migrate();
  if (!googleConfigured()) {
    console.warn(
      '[auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — sign-in will return 503.',
    );
  }
  app.listen(PORT, () => console.log(`Solaris Wallpaper on ${PUBLIC_BASE_URL}`));
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
