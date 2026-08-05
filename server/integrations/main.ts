import { getConfig, type MainSource } from '../config.js';
import { board } from '../state.js';
import { tokenize, centerLine, linesToCells } from '../format.js';
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
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export async function refreshMain(): Promise<void> {
  const cfg = getConfig();
  try {
    const { text, cells } = await fetchMain(cfg.main.selected);
    board.setMain(text, cells ?? undefined);
  } catch (err) {
    console.error(`[main:${cfg.main.selected}]`, (err as Error).message);
  }
}

/** (Re)start the refresh schedule. Call on boot and whenever config changes. */
export function scheduleMain(): void {
  if (timer) clearInterval(timer);
  const minutes = Math.max(1, getConfig().main.refreshMinutes || 5);
  timer = setInterval(refreshMain, minutes * 60 * 1000);
  void refreshMain();
}
