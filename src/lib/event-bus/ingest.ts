import { NextRequest, NextResponse } from 'next/server';
import adminPool from '../admin-db';
import { initAdminDb } from '../admin-db-init';
import { getDecryptedKeys, getInstance } from '../services/instance-registry';
import { dispatchToBridge } from './bridge';
import { validateEnvelope, verifySignature } from './signing';
import { EventBusError, type IngestOutcome, type PlatformEvent } from './types';

const MAX_ENVELOPE_BYTES = 256 * 1024;

/**
 * Next.js Route Handler factory. Used by `app/api/events/ingest/route.ts`.
 *
 * Pipeline (mirrors R1-14 §FR-4):
 *   1. Parse body (drop > 256 KiB).
 *   2. Structural envelope validation.
 *   3. Look up instance in registry by envelope.instanceId.
 *   4. Verify HMAC signature using the instance's API key.
 *   5. Idempotent INSERT into platform_events.
 *   6. Bridge dispatch (best-effort side effects).
 *   7. Return 200.
 */
export function createIngestHandler() {
  return async function POST(req: NextRequest): Promise<NextResponse> {
    try {
      await initAdminDb();

      const raw = await req.text();
      if (raw.length > MAX_ENVELOPE_BYTES) {
        return jsonError(413, 'envelope too large');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return jsonError(400, 'invalid JSON body');
      }

      let envelope: PlatformEvent;
      try {
        envelope = validateEnvelope(parsed);
      } catch (err) {
        if (err instanceof EventBusError) {
          if (err.code === 'UNSUPPORTED_VERSION') {
            // Schema mismatch: ack and drop per spec (FR-4 step 2).
            return jsonOk({ status: 'dropped', reason: err.message });
          }
          return jsonError(400, err.message);
        }
        throw err;
      }

      const instance = await safeGetInstance(envelope.instanceId);
      if (!instance) {
        return jsonError(403, 'unknown instanceId');
      }
      if (instance.status === 'deactivated') {
        return jsonError(403, 'instance is deactivated');
      }

      const keys = await getDecryptedKeys(instance.id);
      const candidates = [keys.active, keys.pending].filter(
        (k): k is string => typeof k === 'string' && k.length > 0,
      );
      if (candidates.length === 0) {
        return jsonError(403, 'instance has no signing key');
      }
      const matched = candidates.some((secret) =>
        verifySignature(envelope, secret),
      );
      if (!matched) {
        return jsonError(401, 'signature verification failed');
      }

      const outcome = await persistEnvelope(envelope, instance.id);
      if (outcome.status === 'accepted') {
        await dispatchToBridge(envelope, { instanceDbId: instance.id });
      }

      return jsonOk(outcome);
    } catch (err) {
      console.error('[event-bus.ingest] handler error', err);
      return jsonError(500, 'internal error');
    }
  };
}

async function safeGetInstance(envelopeInstanceId: string) {
  // The envelope can carry either the registry UUID directly or a slug. The
  // current registry indexes by UUID; tolerate non-UUID slugs by returning
  // null (the instance is then treated as unknown and rejected).
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    envelopeInstanceId,
  );
  if (!looksLikeUuid) return null;
  try {
    return await getInstance(envelopeInstanceId);
  } catch {
    return null;
  }
}

async function persistEnvelope(
  envelope: PlatformEvent,
  instanceDbId: string,
): Promise<IngestOutcome> {
  const result = await adminPool.query<{ id: string }>(
    `INSERT INTO platform_events
       (envelope_id, instance_id, tenant_id, event_type, severity,
        actor_user_id, actor_email, actor_ip_address,
        payload, event_timestamp, schema_version, signature_kid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
     ON CONFLICT (envelope_id) DO NOTHING
     RETURNING id`,
    [
      envelope.id,
      instanceDbId,
      envelope.tenantId ?? null,
      envelope.eventType,
      envelope.severity,
      envelope.actor?.userId ?? null,
      envelope.actor?.email ?? null,
      envelope.actor?.ipAddress ?? null,
      JSON.stringify(envelope.payload ?? {}),
      envelope.timestamp,
      envelope.version,
      envelope.signatureKid,
    ],
  );
  if (result.rowCount === 0) {
    return { status: 'duplicate', envelopeId: envelope.id };
  }
  return { status: 'accepted', envelopeId: envelope.id };
}

function jsonOk(payload: IngestOutcome): NextResponse {
  return NextResponse.json(payload, { status: 200 });
}

function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
