import { one, query } from '../db.js';
import type { BoardSize } from '../../shared/charset.js';
import type { MainSource } from '../config.js';
import { renderSized, type SourceParams } from './main.js';

/**
 * Seconds each source stays cached. Every TTL is <= the minimum refresh
 * interval (1 minute), so per-board behaviour is unchanged: this only dedupes
 * upstream calls ACROSS boards.
 */
const TTL_SECONDS: Record<MainSource, number> = {
  quotes: 0, // special-cased to next UTC midnight
  word: 0, // ditto
  news: 600,
  weather: 600,
  prayer: 1800,
  crypto: 60, // CoinGecko's free tier is the one that will rate-limit us
  flights: 60,
  iss: 15,
  facts: 30,
};

const DAILY: MainSource[] = ['quotes', 'word'];

function expiresAt(source: MainSource): Date {
  if (DAILY.includes(source)) {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0); // next UTC midnight
    return d;
  }
  return new Date(Date.now() + TTL_SECONDS[source] * 1000);
}

/** Cache identity: the source plus whatever parameter changes its output. */
function cacheKey(source: MainSource, p: SourceParams): string {
  switch (source) {
    case 'weather':
      return `weather:${p.weatherLocation.trim().toLowerCase()}`;
    case 'crypto':
      return `crypto:${p.coin}`;
    case 'prayer':
      return `prayer:${p.prayerLocation.trim().toLowerCase()}`;
    case 'flights':
      return `flights:${p.flightsLocation.trim().toLowerCase()}`;
    default:
      return source;
  }
}

export interface Rendered {
  text: string;
  cells: string[];
}

/** Render a source, reusing another board's recent fetch when one exists. */
export async function getCachedSource(
  source: MainSource,
  params: SourceParams,
  size: BoardSize,
): Promise<Rendered> {
  const key = cacheKey(source, params);

  const hit = await one<{ text: string; cells: string[] }>(
    `select text, cells from source_cache
      where cache_key = $1 and rows = $2 and cols = $3 and expires_at > now()`,
    [key, size.rows, size.cols],
  );
  if (hit?.cells) return { text: hit.text, cells: hit.cells };

  const fresh = await renderSized(source, params, size);

  await query(
    `insert into source_cache (cache_key, rows, cols, text, cells, fetched_at, expires_at)
     values ($1, $2, $3, $4, $5, now(), $6)
     on conflict (cache_key, rows, cols) do update
       set text = excluded.text,
           cells = excluded.cells,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at`,
    [key, size.rows, size.cols, fresh.text, JSON.stringify(fresh.cells), expiresAt(source)],
  );

  return fresh;
}
