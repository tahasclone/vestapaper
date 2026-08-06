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
  if (!token) throw new ApiError(400, 'No board token');
  const qs = since ? `?since=${since}` : '';
  return request<BoardStateResponse>(
    `/api/b/${encodeURIComponent(token)}/state${qs}`,
    { signal },
  );
}

// -------------------------------------------------------------- account

export interface Integration {
  kind: 'telegram' | 'slack' | 'discord';
  enabled: boolean;
  configured: boolean;
  status: 'unconfigured' | 'ok' | 'pending' | 'error' | string;
  statusDetail: string | null;
  channelFilter: string | null;
  lastEventAt: string | null;
  webhookUrl: string | null;
}

export interface Me {
  user: { email: string; name?: string; pictureUrl?: string } | null;
  board: { token: string; rows: number; cols: number; boardUrl: string };
  config: any;
  integrations: Integration[];
}

export function saveIntegration(
  kind: string,
  fields: Record<string, string>,
): Promise<{ ok: boolean; detail?: string; webhookUrl?: string }> {
  return request(`/api/board/integrations/${encodeURIComponent(kind)}`, {
    method: 'PUT',
    body: fields,
  });
}

export function deleteIntegration(kind: string): Promise<{ ok: boolean }> {
  return request(`/api/board/integrations/${encodeURIComponent(kind)}`, {
    method: 'DELETE',
    body: {},
  });
}

export function getMe(): Promise<Me> {
  return request<Me>('/api/me');
}

export function saveConfig(patch: unknown): Promise<{ ok: boolean; config: any }> {
  return request('/api/board/config', { body: patch });
}

export function sendMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  return request('/api/board/message', { body: { text } });
}

export function testSource(
  key: string,
  patch: Record<string, unknown> = {},
): Promise<{ ok: boolean; detail?: string; error?: string }> {
  return request(`/api/board/test/${encodeURIComponent(key)}`, { body: patch });
}

export function rotateBoardToken(): Promise<{ ok: boolean; token: string; boardUrl: string }> {
  return request('/api/board/rotate-token', { body: {} });
}

// -------------------------------------------------------------------- auth

/** Sign out this device only. */
export function logout(): Promise<{ ok: boolean }> {
  return request('/auth/logout', { body: {} });
}

/** Sign out every device, for when one is lost. */
export function logoutEverywhere(): Promise<{ ok: boolean }> {
  return request('/auth/logout-all', { body: {} });
}
