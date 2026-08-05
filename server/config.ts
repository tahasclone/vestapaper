import { z } from 'zod';

export const MAIN_SOURCES = [
  'weather',
  'quotes',
  'news',
  'crypto',
  'word',
  'iss',
  'prayer',
  'facts',
  'flights',
] as const;

export type MainSource = (typeof MAIN_SOURCES)[number];

export const COINS = [
  'bitcoin',
  'ethereum',
  'solana',
  'dogecoin',
  'ripple',
  'cardano',
] as const;

/**
 * Per-board preferences. Stored wholesale as boards.config JSONB: it is always
 * read and written as a unit, holds no secrets, and needs no indexing, so a new
 * source needs no migration. Credentials live in board_integrations instead,
 * because those need per-column encryption and an indexed reverse lookup.
 */
export interface Config {
  main: {
    selected: MainSource;
    rotate: boolean;
    rotationSources: MainSource[];
    refreshMinutes: number;
    weather: { location: string };
    crypto: { coin: string };
    prayer: { location: string };
    flights: { location: string };
  };
  sound: { enabled: boolean; volume: number };
}

export const DEFAULT_CONFIG: Config = {
  main: {
    selected: 'quotes',
    rotate: false,
    rotationSources: ['word', 'iss', 'prayer', 'facts', 'flights'],
    refreshMinutes: 5,
    weather: { location: 'Dubai' },
    crypto: { coin: 'bitcoin' },
    prayer: { location: 'Dubai' },
    flights: { location: 'Dubai' },
  },
  sound: { enabled: false, volume: 0.4 },
};

// Letters (any script), digits, spaces and a little punctuation. Keeps the
// value usable as a geocoding query without becoming a URL-injection vector.
const LOCATION_RE = /^[\p{L}\p{N}\s,.'-]{1,64}$/u;
const location = z.string().trim().min(1).max(64).regex(LOCATION_RE);

/**
 * Whitelist for incoming config patches. Every field optional, because
 * POST /api/board/config is a partial patch, not a replace.
 */
export const ConfigPatchSchema = z
  .object({
    main: z
      .object({
        selected: z.enum(MAIN_SOURCES),
        rotate: z.boolean(),
        rotationSources: z.array(z.enum(MAIN_SOURCES)).max(MAIN_SOURCES.length),
        refreshMinutes: z.number().int().min(1).max(720),
        weather: z.object({ location }).partial(),
        crypto: z.object({ coin: z.enum(COINS) }).partial(),
        prayer: z.object({ location }).partial(),
        flights: z.object({ location }).partial(),
      })
      .partial(),
    sound: z
      .object({
        enabled: z.boolean(),
        volume: z.number().min(0).max(1),
      })
      .partial(),
  })
  .partial()
  .strict();

export type ConfigPatch = z.infer<typeof ConfigPatchSchema>;

// Keys that would let a JSON payload reach Object.prototype.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function deepMerge<T>(base: T, patch: any): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/** Fill in anything a stored config predates. */
export function withDefaults(stored: unknown): Config {
  return deepMerge(structuredClone(DEFAULT_CONFIG), stored ?? {});
}
