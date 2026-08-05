import { getConfig, type MainSource } from '../config.js';
import { board } from '../state.js';
import { tokenize, centerLine, linesToCells, formatToCells } from '../format.js';
import { ROWS } from '../../shared/charset.js';

const WEATHER_CODES: Record<number, string> = {
  0: 'CLEAR SKY',
  1: 'MAINLY CLEAR',
  2: 'PARTLY CLOUDY',
  3: 'OVERCAST',
  45: 'FOG',
  48: 'RIME FOG',
  51: 'LIGHT DRIZZLE',
  53: 'DRIZZLE',
  55: 'HEAVY DRIZZLE',
  61: 'LIGHT RAIN',
  63: 'RAIN',
  65: 'HEAVY RAIN',
  66: 'FREEZING RAIN',
  67: 'FREEZING RAIN',
  71: 'LIGHT SNOW',
  73: 'SNOW',
  75: 'HEAVY SNOW',
  77: 'SNOW GRAINS',
  80: 'RAIN SHOWERS',
  81: 'RAIN SHOWERS',
  82: 'HEAVY SHOWERS',
  85: 'SNOW SHOWERS',
  86: 'SNOW SHOWERS',
  95: 'THUNDERSTORM',
  96: 'THUNDERSTORM',
  99: 'THUNDERSTORM',
};

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function centeredBlock(lines: string[][]): string[] {
  const offset = Math.floor((ROWS - lines.length) / 2);
  const grid: string[][] = new Array(ROWS).fill(null).map(() => []);
  lines.forEach((l, i) => {
    if (offset + i < ROWS) grid[offset + i] = centerLine(l);
  });
  return linesToCells(grid);
}

export async function fetchWeather(location: string): Promise<{ text: string; cells: string[] }> {
  let lat: number, lon: number, name: string;
  const coordMatch = location.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    lat = parseFloat(coordMatch[1]);
    lon = parseFloat(coordMatch[2]);
    name = 'YOUR LOCATION';
  } else {
    const geo = await getJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en`,
    );
    const hit = geo?.results?.[0];
    if (!hit) throw new Error(`Location "${location}" not found`);
    lat = hit.latitude;
    lon = hit.longitude;
    name = hit.name;
  }
  const wx = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`,
  );
  const cur = wx.current;
  const daily = wx.daily;
  const desc = WEATHER_CODES[cur.weather_code] ?? 'UNSETTLED';
  const lines = [
    tokenize(`{yellow} ${name.toUpperCase()} {yellow}`),
    tokenize(`${Math.round(cur.temperature_2m)}° ${desc}`),
    tokenize(`HIGH ${Math.round(daily.temperature_2m_max[0])}° LOW ${Math.round(daily.temperature_2m_min[0])}°`),
    tokenize(`HUMIDITY ${Math.round(cur.relative_humidity_2m)}%`),
    tokenize(`WIND ${Math.round(cur.wind_speed_10m)} KM/H`),
  ];
  return { text: `${name}: ${cur.temperature_2m}° ${desc}`, cells: centeredBlock(lines) };
}

export async function fetchQuote(): Promise<{ text: string; cells?: string[] }> {
  const data = await getJson('https://zenquotes.io/api/today');
  const q = data?.[0];
  if (!q?.q) throw new Error('ZenQuotes returned no quote');
  return { text: `${q.q} -${q.a}` };
}

export async function fetchNews(): Promise<{ text: string; cells: string[] }> {
  const ids: number[] = await getJson('https://hacker-news.firebaseio.com/v0/topstories.json');
  const top = await Promise.all(
    ids.slice(0, 3).map((id) => getJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)),
  );
  const lines: string[][] = [tokenize('{orange} HACKER NEWS {orange}')];
  for (const story of top) {
    if (!story?.title) continue;
    const toks = tokenize(story.title).slice(0, 22);
    lines.push([]);
    lines.push(toks);
  }
  // headline rows are left-aligned inside a centered block for readability
  const offset = Math.floor((ROWS - lines.length) / 2);
  const grid: string[][] = new Array(ROWS).fill(null).map(() => []);
  lines.forEach((l, i) => {
    const row = offset + i;
    if (row >= 0 && row < ROWS) grid[row] = i === 0 ? centerLine(l) : l;
  });
  return { text: top.map((s) => s?.title).filter(Boolean).join(' / '), cells: linesToCells(grid) };
}

const COIN_LABELS: Record<string, string> = {
  bitcoin: 'BITCOIN',
  ethereum: 'ETHEREUM',
  solana: 'SOLANA',
  dogecoin: 'DOGECOIN',
  ripple: 'XRP',
  cardano: 'CARDANO',
};

export async function fetchCrypto(coin: string): Promise<{ text: string; cells: string[] }> {
  const data = await getJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=usd&include_24hr_change=true`,
  );
  const info = data?.[coin];
  if (!info) throw new Error(`Unknown coin "${coin}"`);
  const price = info.usd >= 1000 ? Math.round(info.usd).toLocaleString('en-US') : String(info.usd);
  const change = info.usd_24h_change ?? 0;
  const arrowColor = change >= 0 ? '{green}' : '{red}';
  const sign = change >= 0 ? '+' : '';
  const lines = [
    tokenize(`{yellow} ${COIN_LABELS[coin] ?? coin.toUpperCase()} {yellow}`),
    [],
    tokenize(`$${price}`),
    tokenize(`24H ${sign}${change.toFixed(1)}% ${arrowColor}`),
  ];
  return {
    text: `${coin} $${price} (${sign}${change.toFixed(1)}%)`,
    cells: centeredBlock(lines),
  };
}

// A curated drum of words for Word of the Day; the date picks deterministically.
const WORDS = [
  'SERENDIPITY', 'PETRICHOR', 'EPHEMERAL', 'LUMINOUS', 'SONDER', 'HIRAETH',
  'MELLIFLUOUS', 'HALCYON', 'ELOQUENT', 'SOLITUDE', 'WANDERLUST', 'EUPHORIA',
  'LABYRINTH', 'NEBULOUS', 'QUIXOTIC', 'RESILIENCE', 'SYMPHONY', 'TRANQUIL',
  'UBIQUITOUS', 'VERDANT', 'WHIMSICAL', 'ZENITH', 'ALCHEMY', 'CASCADE',
  'DICHOTOMY', 'EBULLIENT', 'FORTITUDE', 'GOSSAMER', 'IRIDESCENT', 'JUXTAPOSE',
  'KALEIDOSCOPE', 'LANGUID', 'MERAKI', 'NOSTALGIA', 'OBLIVION', 'PANACEA',
  'QUINTESSENCE', 'REVERIE', 'SONOROUS', 'TESSELLATE', 'UMBRAGE', 'VELLICHOR',
  'ZEPHYR', 'APRICITY', 'BUCOLIC', 'CYNOSURE', 'DULCET', 'ELYSIAN',
  'FELICITY', 'GRANDILOQUENT', 'INEFFABLE', 'LIMERENCE', 'MOXIE', 'NADIR',
  'OPULENT', 'PERSPICACIOUS', 'RHAPSODY', 'SAGACIOUS', 'TACITURN', 'UNDULATE',
  'VESTIGE', 'WINSOME', 'AURORA', 'BREVITY', 'CANDOR', 'DILIGENT',
  'EFFERVESCENT', 'FATHOM', 'GARRULOUS', 'HUBRIS', 'IMPETUS', 'JOVIAL',
  'KINETIC', 'LUCID', 'MAVERICK', 'NUANCE', 'OSCILLATE', 'PARAGON',
  'QUANDARY', 'RECALCITRANT', 'STOIC', 'TENACIOUS', 'UNCTUOUS', 'VORACIOUS',
].map((w) => w.replace(/[^A-Z]/gi, '').toUpperCase());

export async function fetchWord(): Promise<{ text: string; cells: string[] }> {
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const word = WORDS[dayIndex % WORDS.length];
  let partOfSpeech = '';
  let definition = '';
  try {
    const data = await getJson(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`,
    );
    const meaning = data?.[0]?.meanings?.[0];
    partOfSpeech = meaning?.partOfSpeech ?? '';
    definition = meaning?.definitions?.[0]?.definition ?? '';
  } catch {
    // dictionary miss: still show the word on its own
  }
  const body = [`{blue} WORD OF THE DAY {blue}`, '', word];
  if (definition) {
    body.push(partOfSpeech ? `(${partOfSpeech}) ${definition}` : definition);
  }
  return {
    text: `${word}: ${definition}`,
    cells: formatToCells(body.join('\n')),
  };
}

export async function fetchIss(): Promise<{ text: string; cells: string[] }> {
  const iss = await getJson('https://api.wheretheiss.at/v1/satellites/25544');
  let over = 'THE OPEN OCEAN';
  try {
    const geo = await getJson(
      `https://api.wheretheiss.at/v1/coordinates/${iss.latitude},${iss.longitude}`,
    );
    if (geo?.country_code && geo.country_code !== '??') {
      over =
        new Intl.DisplayNames(['en'], { type: 'region' }).of(geo.country_code) ??
        geo.country_code;
    }
  } catch {
    // coordinates endpoint is best-effort
  }
  const lat = `${Math.abs(iss.latitude).toFixed(1)}°${iss.latitude >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(iss.longitude).toFixed(1)}°${iss.longitude >= 0 ? 'E' : 'W'}`;
  const lines = [
    tokenize(`{blue} ISS RIGHT NOW {blue}`),
    tokenize(`OVER ${over.toUpperCase()}`),
    tokenize(`${lat} ${lon}`),
    tokenize(`ALT ${Math.round(iss.altitude)} KM`),
    tokenize(`${Math.round(iss.velocity).toLocaleString('en-US')} KM/H`),
  ];
  return {
    text: `ISS over ${over}, ${Math.round(iss.altitude)} km`,
    cells: centeredBlock(lines),
  };
}

const PRAYER_ORDER = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;

export async function fetchPrayer(location: string): Promise<{ text: string; cells: string[] }> {
  const geo = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en`,
  );
  const hit = geo?.results?.[0];
  if (!hit) throw new Error(`Location "${location}" not found`);
  const data = await getJson(
    `https://api.aladhan.com/v1/timings?latitude=${hit.latitude}&longitude=${hit.longitude}`,
  );
  const timings = data?.data?.timings;
  const tz = data?.data?.meta?.timezone;
  if (!timings) throw new Error('Aladhan returned no timings');

  // current HH:MM in the location's timezone, to find the next prayer
  const nowHM = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  }).format(new Date());
  const next =
    PRAYER_ORDER.find((p) => String(timings[p]) > nowHM) ?? PRAYER_ORDER[0];

  const lines = [tokenize(`{green} ${hit.name.toUpperCase()} PRAYERS {green}`)];
  for (const p of PRAYER_ORDER) {
    const name = p.toUpperCase().padEnd(9, ' ');
    const marker = p === next ? '{green} ' : '';
    lines.push(tokenize(`${marker}${name}${timings[p]}`));
  }
  const grid = lines.slice(0, ROWS).map((l) => centerLine(l));
  return {
    text: `Next prayer ${next} at ${timings[next]}`,
    cells: linesToCells(grid),
  };
}

export async function fetchFacts(): Promise<{ text: string; cells: string[] }> {
  const data = await getJson('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en');
  if (!data?.text) throw new Error('No fact returned');
  return {
    text: data.text,
    cells: formatToCells(`{orange} DID YOU KNOW? {orange}\n${data.text}`),
  };
}

export async function fetchMain(source: MainSource): Promise<{ text: string; cells?: string[] }> {
  const cfg = getConfig();
  switch (source) {
    case 'weather':
      return fetchWeather(cfg.main.weather.location);
    case 'quotes':
      return fetchQuote();
    case 'news':
      return fetchNews();
    case 'crypto':
      return fetchCrypto(cfg.main.crypto.coin);
    case 'word':
      return fetchWord();
    case 'iss':
      return fetchIss();
    case 'prayer':
      return fetchPrayer(cfg.main.prayer.location);
    case 'facts':
      return fetchFacts();
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let rotationIndex = 0;

export async function refreshMain(): Promise<void> {
  const cfg = getConfig();
  let source = cfg.main.selected;
  if (cfg.main.rotate && cfg.main.rotationSources.length > 0) {
    source = cfg.main.rotationSources[rotationIndex % cfg.main.rotationSources.length];
    rotationIndex++;
  }
  try {
    const { text, cells } = await fetchMain(source);
    board.setMain(text, cells ?? undefined);
  } catch (err) {
    console.error(`[main:${source}]`, (err as Error).message);
  }
}

/** (Re)start the refresh schedule. Call on boot and whenever config changes. */
export function scheduleMain(): void {
  if (timer) clearInterval(timer);
  const minutes = Math.max(1, getConfig().main.refreshMinutes || 5);
  timer = setInterval(refreshMain, minutes * 60 * 1000);
  void refreshMain();
}
