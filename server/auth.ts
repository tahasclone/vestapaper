import crypto from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { one, query } from './db.js';
import { createBoard, getBoardByUser, type BoardRow } from './boardService.js';

const COOKIE = 'solaris_session';
const SESSION_DAYS = 30;
const STATE_TTL_MINUTES = 10;

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const VALID_ISS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  picture_url: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      board?: BoardRow;
    }
  }
}

const clientId = () => process.env.GOOGLE_CLIENT_ID ?? '';
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET ?? '';

export const googleConfigured = () => !!clientId() && !!clientSecret();

const rand = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/**
 * The ID token's signature is deliberately NOT verified. We receive it from a
 * direct server-to-server exchange with Google over TLS, which OIDC Core
 * §3.1.3.7 explicitly permits, so there is no JWKS fetch or key rotation to
 * maintain. This is only safe because we never accept an ID token from the
 * browser — do not add an endpoint that does.
 */
function decodeIdToken(idToken: string): Record<string, any> {
  const payload = idToken.split('.')[1];
  if (!payload) throw new Error('Malformed ID token');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/** Only same-origin paths, so the redirect can't be pointed off-site. */
function safeReturnTo(value: unknown): string {
  const s = typeof value === 'string' ? value : '';
  return s.startsWith('/') && !s.startsWith('//') ? s : '/app';
}

function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

// Always derived from configuration, never from the Host header: host-header
// injection into an OAuth redirect is a real attack.
const redirectUri = () => `${baseUrl()}/auth/google/callback`;

/**
 * Hand-rolled rather than pulling in a cookie library: the value is always a
 * base64url session id, so there is nothing to escape.
 *
 * SameSite=Lax, not Strict — Strict can drop the cookie on the top-level
 * redirect back from Google, which would silently break sign-in.
 */
function sessionCookie(id: string, maxAgeSeconds: number): string {
  const parts = [
    `${COOKIE}=${id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (baseUrl().startsWith('https://')) parts.push('Secure');
  return parts.join('; ');
}

function setSessionCookie(res: Response, id: string) {
  res.setHeader('Set-Cookie', sessionCookie(id, SESSION_DAYS * 24 * 60 * 60));
}

function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', sessionCookie('', 0));
}

function sessionIdFrom(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() === COOKIE) {
      const value = pair.slice(eq + 1).trim();
      // Session ids are base64url; anything else is not ours.
      return /^[A-Za-z0-9_-]{16,}$/.test(value) ? value : null;
    }
  }
  return null;
}

// ------------------------------------------------------------- middleware

/**
 * Loads session, user and board in ONE query. `last_used_at` is only written
 * once an hour, so a poll isn't also a write.
 */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const id = sessionIdFrom(req);
  if (!id) return next();
  try {
    const row = await one<any>(
      `select u.id as user_id, u.email, u.name, u.picture_url, s.last_used_at
         from sessions s join users u on u.id = s.user_id
        where s.id = $1 and s.expires_at > now()`,
      [id],
    );
    if (row) {
      req.user = {
        id: row.user_id,
        email: row.email,
        name: row.name,
        picture_url: row.picture_url,
      };
      if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 3_600_000) {
        void query('update sessions set last_used_at = now() where id = $1', [id]);
      }
    }
  } catch (err) {
    console.error('[auth] session lookup failed:', (err as Error).message);
  }
  next();
}

/**
 * Gate for everything that touches a board. Resolves the board from the
 * SESSION, never from a client-supplied id, which makes cross-tenant access
 * structurally impossible rather than something a check has to remember.
 */
export async function requireBoard(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  const board = (await getBoardByUser(req.user.id)) ?? (await createBoard(req.user.id));
  req.board = board;
  next();
}

/** Blocks cross-site writes. Webhooks are exempt: they carry signatures, not cookies. */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (origin && origin !== baseUrl()) {
    return res.status(403).json({ error: 'Cross-origin request refused' });
  }
  next();
}

// ------------------------------------------------------------------ routes

export function mountAuth(app: Express) {
  app.get('/auth/google', async (req, res) => {
    if (!googleConfigured()) {
      return res.status(503).send('Google sign-in is not configured on this server.');
    }
    const state = rand();
    const nonce = rand();
    const verifier = rand();
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    await query(
      `insert into oauth_states (state, nonce, code_verifier, return_to, expires_at)
       values ($1, $2, $3, $4, now() + interval '${STATE_TTL_MINUTES} minutes')`,
      [state, nonce, verifier, safeReturnTo(req.query.return_to)],
    );

    const url = new URL(GOOGLE_AUTH);
    url.searchParams.set('client_id', clientId());
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');
    res.redirect(url.toString());
  });

  app.get('/auth/google/callback', async (req, res) => {
    const fail = (why: string) => {
      console.error('[auth]', why);
      res.redirect('/login?error=1');
    };
    if (!googleConfigured()) return fail('Google not configured');
    if (req.query.error) return fail(`Google returned ${req.query.error}`);

    const state = String(req.query.state ?? '');
    const code = String(req.query.code ?? '');
    if (!state || !code) return fail('Missing state or code');

    // Single-use by construction: the delete and the read are one statement.
    const pending = await one<{ nonce: string; code_verifier: string; return_to: string }>(
      `delete from oauth_states where state = $1 and expires_at > now()
       returning nonce, code_verifier, return_to`,
      [state],
    );
    if (!pending) return fail('Unknown or expired state');

    let claims: Record<string, any>;
    try {
      const tokenRes = await fetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId(),
          client_secret: clientSecret(),
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri(),
          code_verifier: pending.code_verifier,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body: any = await tokenRes.json();
      if (!tokenRes.ok || !body.id_token) {
        return fail(`Token exchange failed: ${body.error_description ?? body.error ?? tokenRes.status}`);
      }
      claims = decodeIdToken(body.id_token);
    } catch (err) {
      return fail(`Token exchange error: ${(err as Error).message}`);
    }

    if (claims.aud !== clientId()) return fail('ID token audience mismatch');
    if (!VALID_ISS.has(String(claims.iss))) return fail('ID token issuer mismatch');
    if (Number(claims.exp) * 1000 <= Date.now()) return fail('ID token expired');
    if (claims.nonce !== pending.nonce) return fail('Nonce mismatch');
    if (claims.email_verified !== true) return fail('Google account email not verified');
    if (!claims.sub || !claims.email) return fail('ID token missing sub or email');

    // Match on `sub`. Emails get reassigned; the subject never does.
    const user = await one<{ id: string }>(
      `insert into users (google_sub, email, name, picture_url, last_login_at)
            values ($1, $2, $3, $4, now())
       on conflict (google_sub) do update
              set email = excluded.email,
                  name = excluded.name,
                  picture_url = excluded.picture_url,
                  last_login_at = now()
         returning id`,
      [claims.sub, claims.email, claims.name ?? null, claims.picture ?? null],
    );
    if (!user) return fail('Could not create user');

    // Every account gets a board on first sign-in.
    if (!(await getBoardByUser(user.id))) await createBoard(user.id);

    const sessionId = rand();
    await query(
      `insert into sessions (id, user_id, expires_at, user_agent)
       values ($1, $2, now() + interval '${SESSION_DAYS} days', $3)`,
      [sessionId, user.id, String(req.headers['user-agent'] ?? '').slice(0, 300)],
    );
    setSessionCookie(res, sessionId);
    res.redirect(pending.return_to || '/app');
  });

  app.post('/auth/logout', async (req, res) => {
    const id = sessionIdFrom(req);
    if (id) await query('delete from sessions where id = $1', [id]).catch(() => {});
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  /** Sign out everywhere. Useful when a device is lost. */
  app.post('/auth/logout-all', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    await query('delete from sessions where user_id = $1', [req.user.id]);
    clearSessionCookie(res);
    res.json({ ok: true });
  });
}
