/**
 * Centralized Pub/Sub event bus — envelope contract & driver interface.
 * Mirrors R1-14 §FR-2 and S102 §5.
 */

export const ENVELOPE_VERSION = '1' as const;

export const SEVERITY = ['info', 'warning', 'error', 'critical'] as const;
export type Severity = (typeof SEVERITY)[number];

export const EVENT_TYPES = {
  // Security
  USER_LOGIN: 'user.login',
  USER_LOGIN_FAILED: 'user.login_failed',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_INVITED: 'user.invited',
  USER_REMOVED: 'user.removed',

  // Tenant lifecycle
  TENANT_CREATED: 'tenant.created',
  TENANT_SUSPENDED: 'tenant.suspended',
  TENANT_ACTIVATED: 'tenant.activated',
  TENANT_DELETED: 'tenant.deleted',
  TENANT_PLAN_CHANGED: 'tenant.plan_changed',

  // License (mixed direction)
  LICENSE_ACTIVATED: 'license.activated',
  LICENSE_EXPIRED: 'license.expired',
  LICENSE_REVOKED: 'license.revoked',
  LICENSE_DELIVERED: 'license.delivered',
  LICENSE_STATUS_CHANGED: 'license.status_changed',

  // Audit (instance → superadmin mirror)
  AUDIT_ENTRY_CREATED: 'audit.entry_created',

  // System
  SYSTEM_ERROR: 'system.error',
  SYSTEM_HEALTH_DEGRADED: 'system.health_degraded',
  SYSTEM_HEALTH_PING: 'system.health_ping',
  INSTANCE_STARTED: 'instance.started',
  INSTANCE_STOPPED: 'instance.stopped',

  // Usage
  USAGE_DAILY_SUMMARY: 'usage.daily_summary',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface Actor {
  userId?: string | null;
  email?: string | null;
  ipAddress?: string | null;
}

/**
 * The wire-level envelope. All publishers and subscribers in both apps
 * (main EA + superadmin) MUST conform to this shape. Schema-version-bumped
 * envelopes are dropped to DLQ at ingest.
 */
export interface PlatformEvent {
  id: string;
  version: typeof ENVELOPE_VERSION;
  instanceId: string;
  tenantId?: string | null;
  eventType: string;
  severity: Severity;
  actor?: Actor;
  payload: Record<string, unknown>;
  timestamp: string;
  signature: string;
  signatureKid: string;
}

/**
 * Optional Pub/Sub message attributes carried alongside the envelope body.
 * These let consumers filter without parsing the JSON body. Mirrors
 * R1-14 §FR-1 attribute table.
 */
export interface EventAttributes {
  instanceId: string;
  eventType: string;
  severity: Severity;
  schemaVersion: string;
  /** When set, only the named target instance should consume the event. */
  targetInstanceId?: string;
}

/**
 * Driver interface — transports bytes + attributes; knows nothing of envelope semantics.
 * Driver-specific options (target URL, GCP project, queue name) come from env or driver config.
 */
export interface EventBusDriver {
  readonly name: 'memory' | 'http';
  publish(envelope: PlatformEvent, attrs: EventAttributes): Promise<void>;
  /** Optional drain — drivers without buffering can no-op. */
  flush?(): Promise<void>;
  /** Release any sockets / handlers. Idempotent. */
  close(): Promise<void>;
}

export type IngestOutcome =
  | { status: 'accepted'; envelopeId: string }
  | { status: 'duplicate'; envelopeId: string }
  | { status: 'dropped'; reason: string };

export class EventBusError extends Error {
  constructor(
    message: string,
    public code:
      | 'INVALID_ENVELOPE'
      | 'BAD_SIGNATURE'
      | 'UNKNOWN_INSTANCE'
      | 'INACTIVE_INSTANCE'
      | 'UNSUPPORTED_VERSION'
      | 'TOO_LARGE'
      | 'TRANSPORT_FAILURE',
  ) {
    super(message);
    this.name = 'EventBusError';
  }
}
