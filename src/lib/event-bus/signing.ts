import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  ENVELOPE_VERSION,
  EventBusError,
  type PlatformEvent,
  type Severity,
} from './types';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SEVERITIES: ReadonlyArray<Severity> = [
  'info',
  'warning',
  'error',
  'critical',
];
const EVENT_TYPE_REGEX = /^[a-z_]+\.[a-z_]+$/;
const SIGNATURE_REGEX = /^sha256=[0-9a-f]{64}$/;

/**
 * Generate a Crockford-base32 ULID (26 chars). Time component is millisecond
 * precision; randomness component is 80 bits. Sortable by emission time.
 */
export function generateEnvelopeId(now: number = Date.now()): string {
  const time = encodeTime(now, 10);
  const random = encodeRandom(16);
  return time + random;
}

function encodeTime(ms: number, len: number): string {
  let out = '';
  let n = ms;
  for (let i = 0; i < len; i++) {
    const mod = n % 32;
    out = ULID_ALPHABET[mod] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function encodeRandom(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ULID_ALPHABET[bytes[i] % 32];
  }
  return out;
}

/**
 * Canonical signing form — JSON with **sorted top-level keys** and the
 * `signature` and `signatureKid` fields excluded. Both publisher and
 * subscriber MUST canonicalize identically.
 */
export function canonicalize(envelope: PlatformEvent): string {
  const { signature: _sig, signatureKid: _kid, ...rest } = envelope;
  void _sig;
  void _kid;
  const keys = Object.keys(rest).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys) {
    ordered[k] = (rest as Record<string, unknown>)[k];
  }
  return JSON.stringify(ordered);
}

export function signEnvelope(
  envelope: Omit<PlatformEvent, 'signature' | 'signatureKid'>,
  secret: string,
  signatureKid: string,
): PlatformEvent {
  const fullEnvelope: PlatformEvent = {
    ...envelope,
    signature: 'sha256=' + '0'.repeat(64),
    signatureKid,
  };
  const canonical = canonicalize(fullEnvelope);
  const hmac = createHmac('sha256', secret).update(canonical).digest('hex');
  return { ...fullEnvelope, signature: 'sha256=' + hmac };
}

export function verifySignature(
  envelope: PlatformEvent,
  secret: string,
): boolean {
  if (!SIGNATURE_REGEX.test(envelope.signature)) return false;
  const provided = envelope.signature.slice('sha256='.length);
  const canonical = canonicalize(envelope);
  const expected = createHmac('sha256', secret)
    .update(canonical)
    .digest('hex');
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Structural validation. Does not check signatures or the registered-instance
 * existence — those are separate concerns handled by the ingest pipeline.
 */
export function validateEnvelope(input: unknown): PlatformEvent {
  if (typeof input !== 'object' || input === null) {
    throw new EventBusError('envelope must be an object', 'INVALID_ENVELOPE');
  }
  const env = input as Record<string, unknown>;

  requireString(env, 'id');
  requireString(env, 'version');
  requireString(env, 'instanceId');
  requireString(env, 'eventType');
  requireString(env, 'severity');
  requireString(env, 'timestamp');
  requireString(env, 'signature');
  requireString(env, 'signatureKid');

  if (env.version !== ENVELOPE_VERSION) {
    throw new EventBusError(
      `unsupported envelope version: ${String(env.version)}`,
      'UNSUPPORTED_VERSION',
    );
  }
  if (!ULID_REGEX.test(env.id as string)) {
    throw new EventBusError('id must be a ULID', 'INVALID_ENVELOPE');
  }
  if (!EVENT_TYPE_REGEX.test(env.eventType as string)) {
    throw new EventBusError(
      'eventType must match <category>.<verb>',
      'INVALID_ENVELOPE',
    );
  }
  if (!SEVERITIES.includes(env.severity as Severity)) {
    throw new EventBusError(
      `severity must be one of ${SEVERITIES.join(', ')}`,
      'INVALID_ENVELOPE',
    );
  }
  if (Number.isNaN(Date.parse(env.timestamp as string))) {
    throw new EventBusError(
      'timestamp must be ISO-8601',
      'INVALID_ENVELOPE',
    );
  }
  if (typeof env.payload !== 'object' || env.payload === null) {
    throw new EventBusError(
      'payload must be an object',
      'INVALID_ENVELOPE',
    );
  }

  if (env.tenantId !== undefined && env.tenantId !== null && typeof env.tenantId !== 'string') {
    throw new EventBusError('tenantId must be a string', 'INVALID_ENVELOPE');
  }
  if (env.actor !== undefined && (typeof env.actor !== 'object' || env.actor === null)) {
    throw new EventBusError('actor must be an object', 'INVALID_ENVELOPE');
  }

  return env as unknown as PlatformEvent;
}

function requireString(env: Record<string, unknown>, field: string): void {
  if (typeof env[field] !== 'string' || env[field] === '') {
    throw new EventBusError(
      `${field} is required and must be a string`,
      'INVALID_ENVELOPE',
    );
  }
}
