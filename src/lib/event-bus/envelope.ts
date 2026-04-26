import { createHmac, randomBytes } from 'crypto';

export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface EventActor {
  userId?: string | null;
  email?: string | null;
  ipAddress?: string | null;
}

export interface EventEnvelope<TPayload = Record<string, unknown>> {
  id: string;
  version: '1';
  instanceId: string;
  tenantId: string | null;
  eventType: string;
  severity: EventSeverity;
  actor: EventActor;
  payload: TPayload;
  timestamp: string;
  signature: string;
  signatureKid: string;
}

export interface BuildEnvelopeInput<TPayload> {
  instanceId: string;
  tenantId?: string | null;
  eventType: string;
  severity?: EventSeverity;
  actor?: EventActor;
  payload: TPayload;
  signingSecret: string;
  signatureKid: string;
}

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Generate a ULID — 48-bit timestamp + 80-bit randomness, base32-encoded (26 chars). */
export function generateUlid(now: number = Date.now()): string {
  const timeChars: string[] = [];
  let t = now;
  for (let i = 0; i < 10; i++) {
    timeChars.unshift(CROCKFORD_BASE32[t % 32]);
    t = Math.floor(t / 32);
  }

  const random = randomBytes(10);
  const randomChars: string[] = [];
  for (let i = 0; i < 16; i++) {
    const bitOffset = i * 5;
    const byteIndex = Math.floor(bitOffset / 8);
    const bitIndexInByte = bitOffset % 8;
    const high = random[byteIndex] ?? 0;
    const low = random[byteIndex + 1] ?? 0;
    const combined = ((high << 8) | low) >> (11 - bitIndexInByte);
    randomChars.push(CROCKFORD_BASE32[combined & 0x1f]);
  }

  return timeChars.join('') + randomChars.join('');
}

/** Canonicalize an envelope (sorted keys, no whitespace) for HMAC signing. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

export function buildEnvelope<TPayload>(
  input: BuildEnvelopeInput<TPayload>,
): EventEnvelope<TPayload> {
  const unsigned = {
    id: generateUlid(),
    version: '1' as const,
    instanceId: input.instanceId,
    tenantId: input.tenantId ?? null,
    eventType: input.eventType,
    severity: input.severity ?? 'info',
    actor: input.actor ?? {},
    payload: input.payload,
    timestamp: new Date().toISOString(),
  };

  const signature = createHmac('sha256', input.signingSecret)
    .update(canonicalize(unsigned))
    .digest('hex');

  return {
    ...unsigned,
    signature: `sha256=${signature}`,
    signatureKid: input.signatureKid,
  };
}
