import type { BoardState } from '../../shared/charset';

/** How often the board asks the server for fresh state. */
export const BOARD_POLL_MS = 10_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Unauthorized = () => void;
let onUnauthorized: Unauthorized | null = null;

/** The auth context registers here so any 401 can drop the session state. */
export function setUnauthorizedHandler(fn: Unauthorized | null) {
  onUnauthorized = fn;
}

interface Options {
  method?: string;
  /** Plain JS value; serialized as JSON. Presence implies POST. */
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, init?: Options): Promise<T> {
  const hasBody = init?.body !== undefined;
  const res = await fetch(path, {
    method: init?.method ?? (hasBody ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
  });

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, 'Not signed in');
  }

  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, `Unexpected response from ${path}`);
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`);
  }
  return data as T;
}

// ------------------------------------------------------------------ board

export type BoardStateResponse = BoardState | { unchanged: true; revision: number };

export function isUnchanged(r: BoardStateResponse): r is { unchanged: true; revision: number } {
  return (r as any).unchanged === true;
}

/** Public board state. `since` lets the server answer "nothing changed" cheaply. */
export function getBoardState(
  token: string | null,
  since?: number,
  signal?: AbortSignal,
): Promise<BoardStateResponse> {
  const base = token ? `/api/b/${encodeURIComponent(token)}/state` : '/api/board-state';
  const qs = since ? `?since=${since}` : '';
  return request<BoardStateResponse>(`${base}${qs}`, { signal });
}

// ----------------------------------------------------------------- config

export function getConfig<T = any>(): Promise<T> {
  return request<T>('/api/config');
}

export function saveConfig<T = any>(patch: unknown): Promise<T> {
  return request<T>('/api/config', { body: patch });
}

export function sendMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  return request('/api/message', { body: { text } });
}

export function testSource(
  key: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean; detail?: string; error?: string }> {
  return request(`/api/test/${encodeURIComponent(key)}`, { body: extra });
}
