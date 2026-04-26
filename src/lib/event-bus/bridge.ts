import adminPool from '../admin-db';
import { EVENT_TYPES, type PlatformEvent } from './types';

export interface BridgeContext {
  /** Resolved DB UUID for the envelope's `instanceId` slug. */
  instanceDbId: string;
}

/**
 * Maps verified, persisted incoming envelopes to superadmin-side side
 * effects. Each handler is best-effort: a failure here MUST NOT cause
 * the ingest to nack — the canonical event is already in `platform_events`.
 */
export async function dispatchToBridge(
  envelope: PlatformEvent,
  ctx: BridgeContext,
): Promise<void> {
  try {
    switch (envelope.eventType) {
      case EVENT_TYPES.AUDIT_ENTRY_CREATED:
        await handleAuditEntryCreated(envelope);
        return;
      case EVENT_TYPES.LICENSE_STATUS_CHANGED:
      case EVENT_TYPES.LICENSE_ACTIVATED:
      case EVENT_TYPES.LICENSE_EXPIRED:
      case EVENT_TYPES.LICENSE_REVOKED:
        await handleLicenseStatusChanged(envelope, ctx);
        return;
      case EVENT_TYPES.SYSTEM_HEALTH_PING:
      case EVENT_TYPES.INSTANCE_STARTED:
        await handleSystemHealthPing(envelope, ctx);
        return;
      default:
        return;
    }
  } catch (err) {
    console.error(
      '[event-bus.bridge] handler failed',
      { eventType: envelope.eventType, envelopeId: envelope.id },
      err,
    );
  }
}

/**
 * Mirror an audit entry from an EA instance into the superadmin admin_audit_log.
 * The originating user is not a superadmin, so admin_user_id is left NULL and
 * actor info from the envelope populates the email/IP.
 */
async function handleAuditEntryCreated(envelope: PlatformEvent): Promise<void> {
  const payload = envelope.payload as {
    action?: string;
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
  };

  await adminPool.query(
    `INSERT INTO admin_audit_log
       (admin_user_id, admin_email, action, target_type, target_id, details, ip_address)
     VALUES (NULL, $1, $2, $3, $4, $5::jsonb, $6)`,
    [
      envelope.actor?.email ?? null,
      payload.action ?? envelope.eventType,
      payload.targetType ?? null,
      isUuid(payload.targetId) ? payload.targetId : null,
      JSON.stringify({
        ...(payload.details ?? {}),
        instanceId: envelope.instanceId,
        tenantId: envelope.tenantId ?? null,
        envelopeId: envelope.id,
      }),
      envelope.actor?.ipAddress ?? null,
    ],
  );
}

/**
 * Update the cached license status / ping the instance row when the EA
 * instance reports a license state change. Status changes do not write
 * to the licenses table from this side — those are operator-driven. We
 * only refresh `instances.last_health_check` so the registry knows the
 * instance is alive and reachable.
 */
async function handleLicenseStatusChanged(
  envelope: PlatformEvent,
  ctx: BridgeContext,
): Promise<void> {
  await adminPool.query(
    `UPDATE instances
        SET last_health_check  = NOW(),
            last_health_status = 'healthy',
            updated_at         = NOW()
      WHERE id = $1`,
    [ctx.instanceDbId],
  );
}

async function handleSystemHealthPing(
  envelope: PlatformEvent,
  ctx: BridgeContext,
): Promise<void> {
  const payload = envelope.payload as {
    instanceVersion?: string;
    version?: string;
  };
  const version = payload.instanceVersion ?? payload.version ?? null;

  await adminPool.query(
    `UPDATE instances
        SET last_health_check  = NOW(),
            last_health_status = 'healthy',
            instance_version   = COALESCE($2, instance_version),
            status             = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
            updated_at         = NOW()
      WHERE id = $1`,
    [ctx.instanceDbId, version],
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
