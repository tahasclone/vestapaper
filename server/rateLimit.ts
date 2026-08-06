import type { NextFunction, Request, Response } from 'express';

/**
 * In-memory fixed-window rate limiting.
 *
 * Deliberately not DB-backed: the busiest limiter guards the board-state poll,
 * and a limiter that queried Postgres on every request would cost more than
 * the thing it protects. Counters reset on restart, which is acceptable for
 * abuse-shaping. Anything that needs a durable limit (the support form, whose
 * budget is a finite monthly email quota) is counted in the database instead.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export function hit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  existing.count++;
  return existing.count <= limit;
}

type KeyFn = (req: Request) => string;

export function rateLimit(opts: {
  name: string;
  limit: number;
  windowMs: number;
  key: KeyFn;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = `${opts.name}:${opts.key(req)}`;
    if (hit(id, opts.limit, opts.windowMs)) return next();
    res.setHeader('Retry-After', Math.ceil(opts.windowMs / 1000));
    res.status(429).json({ error: 'Too many requests, slow down' });
  };
}

/** Falls back to the socket address when behind a proxy that sends nothing. */
export const byIp: KeyFn = (req) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
export const byUser: KeyFn = (req) => req.user?.id ?? byIp(req);
export const byToken: KeyFn = (req) => req.params.token ?? byIp(req);
