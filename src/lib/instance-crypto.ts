import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

const API_KEY_PREFIX = 'dfp_';
const API_KEY_RANDOM_BYTES = 32;

const DEV_FALLBACK_KEY_BASE64 =
  'ZGV2LW9ubHkta2V5LWRvLW5vdC11c2UtaW4tcHJvZHVjdGlvbi0=';

let cachedKey: Buffer | null = null;

function loadMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.INSTANCE_CREDENTIALS_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'INSTANCE_CREDENTIALS_KEY is required in production',
      );
    }
    // Dev fallback — derive a deterministic 32-byte key with a loud warning.
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        '[instance-crypto] INSTANCE_CREDENTIALS_KEY not set — using insecure dev fallback. ' +
          'Do NOT deploy this configuration to production.',
      );
    }
    cachedKey = createHash('sha256')
      .update(Buffer.from(DEV_FALLBACK_KEY_BASE64, 'base64'))
      .digest();
    return cachedKey;
  }

  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `INSTANCE_CREDENTIALS_KEY must decode to ${KEY_BYTES} bytes (got ${decoded.length})`,
    );
  }
  cachedKey = decoded;
  return cachedKey;
}

export function generateApiKey(): string {
  const random = randomBytes(API_KEY_RANDOM_BYTES);
  return API_KEY_PREFIX + base64url(random);
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function encryptApiKey(plaintext: string): string {
  const key = loadMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptApiKey(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 3) {
    throw new Error('Encrypted API key has invalid format');
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');

  if (iv.length !== IV_BYTES) {
    throw new Error('Encrypted API key has invalid IV');
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error('Encrypted API key has invalid auth tag');
  }

  const decipher = createDecipheriv(ALGO, loadMasterKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString('utf8');
}

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
