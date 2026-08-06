/**
 * The one place PUBLIC_BASE_URL is interpreted.
 *
 * Everything user-visible is built from this: board URLs, per-user webhook
 * URLs, and the OAuth redirect. It is deliberately never derived from the Host
 * header, because host-header injection into an OAuth redirect is a real
 * attack.
 *
 * Normalized defensively, because a bare hostname here fails in a way that is
 * very hard to read: Google rejects a schemeless redirect_uri with a generic
 * "this app doesn't comply with Google's OAuth 2.0 policy" page that says
 * nothing about the actual cause.
 */
function normalize(raw: string | undefined, port: number): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return `http://localhost:${port}`;
  if (/^https?:\/\//i.test(value)) return value;
  // Scheme omitted: assume http for loopback, https for anything public.
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(value);
  return `${isLocal ? 'http' : 'https'}://${value}`;
}

const PORT = Number(process.env.PORT) || 3000;

export const PUBLIC_BASE_URL = normalize(process.env.PUBLIC_BASE_URL, PORT);

export const isHttps = () => PUBLIC_BASE_URL.startsWith('https://');

/** Warn once at boot about anything that will bite later. */
export function checkBaseUrl(): void {
  const raw = (process.env.PUBLIC_BASE_URL ?? '').trim();
  if (raw && !/^https?:\/\//i.test(raw)) {
    console.warn(
      `[config] PUBLIC_BASE_URL had no scheme ("${raw}"); using ${PUBLIC_BASE_URL}. ` +
        'Set it with https:// to be explicit.',
    );
  }
  if (process.env.NODE_ENV === 'production' && !isHttps()) {
    console.warn(
      `[config] PUBLIC_BASE_URL is not https (${PUBLIC_BASE_URL}). ` +
        'Google sign-in requires https, and session cookies will not be marked Secure.',
    );
  }
}
