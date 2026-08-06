import crypto from 'node:crypto';

/**
 * AES-256-GCM for the bot credentials users paste in.
 *
 * The AAD binds each ciphertext to the row it belongs to, so a blob cannot be
 * copied from one integration to another (or one tenant to another) and still
 * decrypt. key_version exists in the schema so rotating TOKEN_ENC_KEY can be a
 * background re-encrypt rather than a data-loss event.
 */
const KEY_VERSION = 1;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TOKEN_ENC_KEY ?? '';
  if (!raw) {
    throw new Error(
      'TOKEN_ENC_KEY is not set. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`TOKEN_ENC_KEY must decode to 32 bytes, got ${buf.length}`);
  }
  cachedKey = buf;
  return buf;
}

export const encryptionConfigured = () => {
  try {
    key();
    return true;
  } catch {
    return false;
  }
};

export interface Sealed {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
  keyVersion: number;
}

export function seal(value: unknown, aad: string): Sealed {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return { ciphertext, nonce, tag: cipher.getAuthTag(), keyVersion: KEY_VERSION };
}

export function open<T>(sealed: Omit<Sealed, 'keyVersion'>, aad: string): T {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), sealed.nonce);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(sealed.tag);
  const plain = Buffer.concat([
    decipher.update(sealed.ciphertext),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plain) as T;
}

/** Constant-time compare that tolerates differing lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export const randomId = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
