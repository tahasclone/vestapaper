import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export type MainSource =
  | 'weather'
  | 'quotes'
  | 'news'
  | 'crypto'
  | 'word'
  | 'iss'
  | 'prayer'
  | 'facts'
  | 'flights';

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
  messages: {
    telegram: { enabled: boolean; botToken: string };
    discord: { enabled: boolean; botToken: string; channelId: string };
    slack: { enabled: boolean; botToken: string; appToken: string };
    custom: { enabled: boolean };
  };
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
  messages: {
    telegram: { enabled: false, botToken: '' },
    discord: { enabled: false, botToken: '', channelId: '' },
    slack: { enabled: false, botToken: '', appToken: '' },
    custom: { enabled: true },
  },
};

function deepMerge<T>(base: T, patch: Partial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof (out as any)[k] === 'object') {
      out[k] = deepMerge((out as any)[k], v as any);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

let config: Config = load();

function load(): Config {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return deepMerge(DEFAULT_CONFIG, raw);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function getConfig(): Config {
  return config;
}

export function saveConfig(patch: Partial<Config>): Config {
  config = deepMerge(config, patch);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return config;
}

const SECRET = '••••••••';

/** Config safe to send to the browser: secrets replaced with a sentinel. */
export function publicConfig(): any {
  const c = structuredClone(config) as any;
  for (const key of ['telegram', 'discord', 'slack']) {
    const m = c.messages[key];
    for (const field of ['botToken', 'appToken']) {
      if (typeof m[field] === 'string') m[field] = m[field] ? SECRET : '';
    }
  }
  return c;
}

/** Strip sentinel values from an incoming patch so saved secrets survive. */
export function sanitizePatch(patch: any): Partial<Config> {
  const p = structuredClone(patch ?? {});
  for (const key of ['telegram', 'discord', 'slack']) {
    const m = p?.messages?.[key];
    if (!m) continue;
    for (const field of ['botToken', 'appToken']) {
      if (m[field] === SECRET) delete m[field];
    }
  }
  return p;
}
