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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// Trailing slashes stripped so `${base}/b/${token}` can never produce "//b/".
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`).replace(
  /\/+$/,
  '',
);

/**
 * Until Google sign-in lands (phase 3), local development works against a
 * single ownerless board. Never enabled in production.
 */
const DEV_ANON = process.env.NODE_ENV !== 'production';

const app = express();
app.set('trust proxy', 1);

// Per-group parsers rather than a global one: /hooks needs the RAW body for
// signature verification, and making that structural beats a verify callback.
app.use('/api', express.json({ limit: '32kb' }));
app.use('/hooks', express.raw({ type: '*/*', limit: '64kb' }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.get('/healthz', (_req, res) => {
  // Deliberately touches no dependency: a DB-backed check would flap every
  // time Neon resumes from its idle suspend.
  res.type('text').send('ok');
});

// ---------------------------------------------------------------- helpers

/** The board this request acts on. Phase 3 replaces this with the session. */
async function resolveOwnBoard(): Promise<BoardRow | null> {
  if (!DEV_ANON) return null;
  const existing = await one<BoardRow>(
    `select id, user_id, slug, public_token, rows, cols, config,
            main_source, main_text, main_cells, main_fetched_at, rotation_index,
            override_text, override_cells, override_expires_at, revision
       from boards where user_id is null order by created_at limit 1`,
  );
  return existing ?? (await createBoard(null));
}

// ------------------------------------------------------- public board API

app.get('/api/b/:token/state', async (req, res) => {
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
});

// ------------------------------------------------------------- board admin

app.get('/api/me', async (_req, res) => {
  const board = await resolveOwnBoard();
  if (!board) return res.status(401).json({ error: 'Not signed in' });
  void touchLastSeen(board.id);
  res.json({
    user: null,
    board: {
      token: board.public_token,
      rows: board.rows,
      cols: board.cols,
      boardUrl: `${PUBLIC_BASE_URL}/b/${board.public_token}`,
    },
    config: withDefaults(board.config),
  });
});

app.post('/api/board/config', async (req, res) => {
  const board = await resolveOwnBoard();
  if (!board) return res.status(401).json({ error: 'Not signed in' });

  const parsed = ConfigPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid settings', detail: parsed.error.issues[0]?.message });
  }
  const merged = deepMerge(withDefaults(board.config), parsed.data);
  await saveBoardConfig(board.id, merged);
  res.json({ ok: true, config: merged });
});

app.post('/api/board/message', async (req, res) => {
  const board = await resolveOwnBoard();
  if (!board) return res.status(401).json({ error: 'Not signed in' });
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'Empty message' });
  if (text.length > 500) return res.status(400).json({ error: 'Message too long' });
  await setOverride(board.id, text);
  res.json({ ok: true });
});

app.post('/api/board/rotate-token', async (_req, res) => {
  const board = await resolveOwnBoard();
  if (!board) return res.status(401).json({ error: 'Not signed in' });
  const token = await rotateToken(board.id);
  res.json({ ok: true, token, boardUrl: `${PUBLIC_BASE_URL}/b/${token}` });
});

/**
 * Preview one source without changing what the board shows. Routed through the
 * shared cache so repeated clicks cost nothing upstream.
 */
app.post('/api/board/test/:source', async (req, res) => {
  const board = await resolveOwnBoard();
  if (!board) return res.status(401).json({ error: 'Not signed in' });

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
});

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
  await migrate();
  const board = await resolveOwnBoard();
  if (board) {
    invalidateBoardCache(board.public_token);
    console.log(`Dev board: ${PUBLIC_BASE_URL}/b/${board.public_token}`);
  }
  app.listen(PORT, () => console.log(`Solaris Wallpaper on ${PUBLIC_BASE_URL}`));
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
