import adminPool from '../admin-db';
import { markDeleted, upsertTenant } from '../services/tenants-cache';
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
      case EVENT_TYPES.TENANT_CREATED:
      case EVENT_TYPES.TENANT_SUSPENDED:
      case EVENT_TYPES.TENANT_ACTIVATED:
      case EVENT_TYPES.TENANT_PLAN_CHANGED:
        await handleTenantUpsert(envelope, ctx);
        return;
      case EVENT_TYPES.TENANT_DELETED:
        await handleTenantDeleted(envelope, ctx);
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

/**
 * tenant.created / .suspended / .activated / .plan_changed → UPSERT the
 * cache row so the tenants list stays current without waiting for the next
 * manual sync. envelope.tenantId is the authoritative tenant UUID;
 * payload carries the human fields (name, slug, status, plan, counts).
 *
 * If payload omits a field, we let the cache keep its previous value
 * (the COALESCE in tenants-cache.upsertTenant handles this).
 */
async function handleTenantUpsert(
  envelope: PlatformEvent,
  ctx: BridgeContext,
): Promise<void> {
  const tenantId = envelope.tenantId;
  if (!isUuid(tenantId)) {
    console.warn(
      '[event-bus.bridge] tenant event missing tenantId',
      { envelopeId: envelope.id, eventType: envelope.eventType },
    );
    return;
  }

  const payload = envelope.payload as {
    name?: string;
    slug?: string;
    status?: string;
    plan?: string | null;
    userCount?: number;
    objectCount?: number;
    createdAt?: string;
  };

  // Status defaults by event_type when payload doesn't carry an explicit one.
  const inferredStatus =
    payload.status ??
    (envelope.eventType === EVENT_TYPES.TENANT_SUSPENDED ? 'suspended' :
     envelope.eventType === EVENT_TYPES.TENANT_ACTIVATED ? 'active' :
     envelope.eventType === EVENT_TYPES.TENANT_CREATED   ? 'active' :
     'unknown');

  // Name and slug are required by the cache schema. If the event omits
  // them (likely on a status-flip event) we skip the upsert — a later
  // sync will fill in the row. Don't write half-empty cache rows.
  if (!payload.name || !payload.slug) {
    return;
  }

  await upsertTenant({
    instanceId: ctx.instanceDbId,
    tenantId,
    name: payload.name,
    slug: payload.slug,
    status: inferredStatus,
    plan: payload.plan ?? null,
    userCount: payload.userCount,
    objectCount: payload.objectCount,
    createdAtSrc: payload.createdAt ?? null,
    source: 'event',
  });
}

async function handleTenantDeleted(
  envelope: PlatformEvent,
  ctx: BridgeContext,
): Promise<void> {
  const tenantId = envelope.tenantId;
  if (!isUuid(tenantId)) return;
  await markDeleted(ctx.instanceDbId, tenantId);
}
