import crypto from 'node:crypto';
import { one, query } from './db.js';
import { FULL_BOARD, type BoardSize, type BoardState } from '../shared/charset.js';
import { blankCells, formatToCells } from '../shared/format.js';
import { withDefaults, type Config, type MainSource } from './config.js';
import { getCachedSource } from './integrations/cache.js';
import { paramsFromConfig } from './integrations/main.js';

export const OVERRIDE_SECONDS = 60;
const LEASE_SECONDS = 30;
/** Budget for the blocking first fetch on a board that has never rendered. */
const FIRST_FETCH_MS = 6000;

export interface BoardRow {
  id: string;
  user_id: string | null;
  slug: string;
  public_token: string;
  rows: number;
  cols: number;
  config: unknown;
  main_source: MainSource | null;
  main_text: string;
  main_cells: string[] | null;
  main_fetched_at: Date | null;
  rotation_index: number;
  override_text: string | null;
  override_cells: string[] | null;
  override_expires_at: Date | null;
  revision: string | number;
}

export const newToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const boardSize = (b: { rows: number; cols: number }): BoardSize => ({
  rows: b.rows,
  cols: b.cols,
});

const BOARD_COLUMNS = `id, user_id, slug, public_token, rows, cols, config,
  main_source, main_text, main_cells, main_fetched_at, rotation_index,
  override_text, override_cells, override_expires_at, revision`;

const SELECT_BOARD = `select ${BOARD_COLUMNS} from boards`;

export function getBoardByToken(token: string) {
  return one<BoardRow>(`${SELECT_BOARD} where public_token = $1`, [token]);
}

export function getBoardByUser(userId: string) {
  return one<BoardRow>(`${SELECT_BOARD} where user_id = $1 order by created_at limit 1`, [userId]);
}

export function getBoardById(id: string) {
  return one<BoardRow>(`${SELECT_BOARD} where id = $1`, [id]);
}

/** Create a board for a user (or an ownerless one, for local single-user dev). */
export async function createBoard(userId: string | null): Promise<BoardRow> {
  const row = await one<BoardRow>(
    `insert into boards (user_id, public_token, config)
          values ($1, $2, $3::jsonb)
       returning ${BOARD_COLUMNS}`,
    [userId, newToken(), JSON.stringify({})],
  );
  return row!;
}

// --------------------------------------------------------------- rendering

/** Is the cached main content older than this board's refresh interval? */
function isStale(board: BoardRow, cfg: Config): boolean {
  if (!board.main_cells || !board.main_fetched_at) return true;
  const intervalMs = Math.max(1, cfg.main.refreshMinutes) * 60_000;
  return Date.now() - new Date(board.main_fetched_at).getTime() >= intervalMs;
}

/**
 * Try to claim the right to refresh this board. A lease rather than a lock:
 * whoever loses simply serves the cached content, so a board read never blocks
 * on a third-party API.
 */
async function claimLease(boardId: string): Promise<boolean> {
  const got = await one<{ id: string }>(
    `update boards set fetch_lock_at = now()
      where id = $1
        and (fetch_lock_at is null or fetch_lock_at < now() - interval '${LEASE_SECONDS} seconds')
      returning id`,
    [boardId],
  );
  return !!got;
}

/**
 * Fetch the next main-source content and store it. Rotation advances via the
 * persisted rotation_index in the same UPDATE, so no timer is involved.
 */
export async function refreshBoard(boardId: string): Promise<void> {
  const board = await getBoardById(boardId);
  if (!board) return;
  const cfg = withDefaults(board.config);

  let source = cfg.main.selected;
  let nextIndex = board.rotation_index;
  if (cfg.main.rotate && cfg.main.rotationSources.length > 0) {
    const list = cfg.main.rotationSources;
    source = list[board.rotation_index % list.length];
    nextIndex = board.rotation_index + 1;
  }

  try {
    const { text, cells } = await getCachedSource(source, paramsFromConfig(cfg), boardSize(board));
    await query(
      `update boards
          set main_source = $2, main_text = $3, main_cells = $4::jsonb,
              main_fetched_at = now(), rotation_index = $5,
              revision = revision + 1, fetch_lock_at = null
        where id = $1`,
      [boardId, source, text, JSON.stringify(cells), nextIndex],
    );
  } catch (err) {
    console.error(`[board ${board.slug}] ${source}:`, (err as Error).message);
    // Release the lease but keep the previous content on screen.
    await query('update boards set fetch_lock_at = null where id = $1', [boardId]);
  }
}

/**
 * Small in-process cache in front of the state read. Neon's free tier meters
 * CU-hours, and a 10-second poll per board would otherwise keep it permanently
 * awake; this collapses any number of boards to a handful of queries a minute.
 */
const readCache = new Map<string, { at: number; state: BoardState }>();
const READ_CACHE_MS = 4000;

export function invalidateBoardCache(token: string) {
  readCache.delete(token);
}

function toState(board: BoardRow, cfg: Config): BoardState {
  const size = boardSize(board);
  const overrideLive =
    board.override_expires_at !== null && new Date(board.override_expires_at).getTime() > Date.now();

  if (overrideLive) {
    return {
      rows: size.rows,
      cols: size.cols,
      cells: board.override_cells ?? formatToCells(board.override_text ?? '', size),
      source: 'message',
      text: board.override_text ?? '',
      updatedAt: Date.now(),
      expiresAt: new Date(board.override_expires_at!).getTime(),
      revision: Number(board.revision),
      sound: cfg.sound,
    };
  }

  return {
    rows: size.rows,
    cols: size.cols,
    cells: board.main_cells ?? blankCells(size),
    source: 'main',
    text: board.main_text ?? '',
    updatedAt: Date.now(),
    expiresAt: null,
    revision: Number(board.revision),
    sound: cfg.sound,
  };
}

/**
 * The read path. Serves whatever is stored immediately, and refreshes in the
 * background when stale — except on a board that has never rendered, where it
 * waits briefly so a first-time visitor never sees a blank board.
 */
export async function readBoardState(token: string): Promise<BoardState | null> {
  const cached = readCache.get(token);
  if (cached && Date.now() - cached.at < READ_CACHE_MS) return cached.state;

  let board = await getBoardByToken(token);
  if (!board) return null;
  const cfg = withDefaults(board.config);

  if (isStale(board, cfg) && (await claimLease(board.id))) {
    if (!board.main_cells) {
      // First render: block, but never for long.
      await Promise.race([
        refreshBoard(board.id),
        new Promise((r) => setTimeout(r, FIRST_FETCH_MS)),
      ]);
      board = (await getBoardByToken(token)) ?? board;
    } else {
      void refreshBoard(board.id);
    }
  }

  const state = toState(board, cfg);
  readCache.set(token, { at: Date.now(), state });
  return state;
}

// ---------------------------------------------------------------- override

/** Put a message on the board for OVERRIDE_SECONDS. Newest always wins. */
export async function setOverride(boardId: string, text: string): Promise<void> {
  const board = await getBoardById(boardId);
  if (!board) return;
  const cells = formatToCells(text, boardSize(board));
  await query(
    `update boards
        set override_text = $2, override_cells = $3::jsonb,
            override_expires_at = now() + interval '${OVERRIDE_SECONDS} seconds',
            revision = revision + 1
      where id = $1`,
    [boardId, text, JSON.stringify(cells)],
  );
  invalidateBoardCache(board.public_token);
}

// ------------------------------------------------------------------ config

export async function saveBoardConfig(boardId: string, merged: Config): Promise<void> {
  const board = await getBoardById(boardId);
  if (!board) return;
  await query(
    `update boards set config = $2::jsonb, revision = revision + 1,
            main_fetched_at = null
      where id = $1`,
    [boardId, JSON.stringify(merged)],
  );
  // Clearing main_fetched_at makes the next poll re-render with the new settings.
  invalidateBoardCache(board.public_token);
}

export async function rotateToken(boardId: string): Promise<string | null> {
  const board = await getBoardById(boardId);
  if (!board) return null;
  const token = newToken();
  await query(
    'update boards set public_token = $2, token_rotated_at = now() where id = $1',
    [boardId, token],
  );
  invalidateBoardCache(board.public_token);
  return token;
}

/** Throttled so a 10-second poll isn't also a write every 10 seconds. */
export async function touchLastSeen(boardId: string): Promise<void> {
  await query(
    `update boards set last_seen_at = now()
      where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '60 seconds')`,
    [boardId],
  );
}

// -------------------------------------------------------------- gardening

let lastPrune = 0;

/** Opportunistic cleanup, so the app needs no cron. */
export async function maybePrune(): Promise<void> {
  if (Date.now() - lastPrune < 3_600_000) return;
  lastPrune = Date.now();
  try {
    await query(`delete from webhook_events where received_at < now() - interval '2 days'`);
    await query(`delete from oauth_states where expires_at < now()`);
    await query(`delete from sessions where expires_at < now()`);
    await query(`delete from source_cache where expires_at < now() - interval '1 day'`);
  } catch (err) {
    console.error('[prune]', (err as Error).message);
  }
}

export { FULL_BOARD };
