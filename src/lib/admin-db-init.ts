import adminPool from './admin-db';

let initPromise: Promise<void> | null = null;

export function initAdminDb(): Promise<void> {
  if (!initPromise) initPromise = run();
  return initPromise;
}

async function run(): Promise<void> {
  await adminPool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS instances (
      id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                        VARCHAR(255) NOT NULL,
      url                         VARCHAR(512) NOT NULL,
      environment                 VARCHAR(32)  NOT NULL,
      api_key_encrypted           TEXT,
      api_key_hash                CHAR(64),
      pending_api_key_encrypted   TEXT,
      pending_api_key_hash        CHAR(64),
      status                      VARCHAR(32)  NOT NULL DEFAULT 'pending',
      last_health_check           TIMESTAMPTZ,
      last_health_status          VARCHAR(16),
      instance_version            VARCHAR(32),
      key_rotated_at              TIMESTAMPTZ,
      deactivated_at              TIMESTAMPTZ,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await adminPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_instances_url_active
      ON instances (url) WHERE status <> 'deactivated'
  `);

  await adminPool.query(`
    CREATE INDEX IF NOT EXISTS idx_instances_status ON instances (status)
  `);

  // R1-16: self-registration columns. Additive ALTERs so existing rows survive.
  // Widen status to fit 'awaiting_approval' (17 chars) — existing deployments were VARCHAR(16).
  await adminPool.query(`
    ALTER TABLE instances ALTER COLUMN status TYPE VARCHAR(32)
  `);
  await adminPool.query(`
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS registration_source VARCHAR(16) NOT NULL DEFAULT 'manual'
  `);
  await adminPool.query(`
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS first_registered_at TIMESTAMPTZ
  `);
  await adminPool.query(`
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ
  `);
  await adminPool.query(`
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS approved_by UUID
  `);
  await adminPool.query(`
    ALTER TABLE instances ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ
  `);
  await adminPool.query(`
    CREATE INDEX IF NOT EXISTS idx_instances_awaiting_approval
      ON instances (first_registered_at DESC) WHERE status = 'awaiting_approval'
  `);

  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS platform_events (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      envelope_id      VARCHAR(26) UNIQUE,
      instance_id      UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      tenant_id        UUID,
      event_type       VARCHAR(64) NOT NULL,
      severity         VARCHAR(16) NOT NULL DEFAULT 'info',
      actor_user_id    UUID,
      actor_email      VARCHAR(320),
      actor_ip_address VARCHAR(64),
      payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
      event_timestamp  TIMESTAMPTZ,
      received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      schema_version   VARCHAR(8) NOT NULL DEFAULT '1',
      signature_kid    VARCHAR(64)
    )
  `);

  await adminPool.query(`
    ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS envelope_id      VARCHAR(26) UNIQUE
  `);
  await adminPool.query(`
    ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS tenant_id        UUID
  `);
  await adminPool.query(`
    ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS severity         VARCHAR(16) NOT NULL DEFAULT 'info'
  `);
  await adminPool.query(`
    ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS actor_user_id    UUID
  `);
  await adminPool.query(`
    ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS actor_email      VARCHAR(320)
  `);
  await adminPool.query(`
    ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS actor_ip_address VARCHAR(64)
  `);
  await adminPool.query(`
    ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS event_timestamp  TIMESTAMPTZ
  `);
  await adminPool.query(`
    ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS schema_version   VARCHAR(8) NOT NULL DEFAULT '1'
  `);
  await adminPool.query(`
    ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS signature_kid    VARCHAR(64)
  `);

  await adminPool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_events_instance
      ON platform_events (instance_id, received_at DESC)
  `);

  await adminPool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_events_severity
      ON platform_events (severity, received_at DESC)
  `);

  await adminPool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_events_event_type
      ON platform_events (event_type, received_at DESC)
  `);

  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_user_id  UUID,
      admin_email    VARCHAR(255),
      action         VARCHAR(64) NOT NULL,
      target_type    VARCHAR(64),
      target_id      UUID,
      details        JSONB,
      ip_address     VARCHAR(64),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await adminPool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created
      ON admin_audit_log (created_at DESC)
  `);

  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS super_admins (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email           VARCHAR(255) NOT NULL UNIQUE,
      name            VARCHAR(255),
      password_hash   VARCHAR(255),
      status          VARCHAR(16) NOT NULL DEFAULT 'active',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at   TIMESTAMPTZ
    )
  `);

  // tenants_cache — superadmin's denormalised view of tenants that live
  // on individual EA instances. Source of truth is each instance's own
  // tenant table, accessed via /api/v1/platform/tenants. This cache lets
  // the superadmin list/search across instances without fanning out on
  // every page load. It is kept fresh by:
  //   (a) event-bus tenant.* handlers (incremental, near-real-time)
  //   (b) the /api/superadmin/tenants/sync endpoint (manual full refresh)
  //
  // PK is (instance_id, tenant_id) — the same tenant UUID could in theory
  // exist on two instances. ON DELETE CASCADE keeps the cache consistent
  // when an instance is removed from the registry.
  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS tenants_cache (
      instance_id     UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      tenant_id       UUID NOT NULL,
      name            VARCHAR(255) NOT NULL,
      slug            VARCHAR(255) NOT NULL,
      status          VARCHAR(32)  NOT NULL DEFAULT 'unknown',
      plan            VARCHAR(32),
      user_count      INTEGER      NOT NULL DEFAULT 0,
      object_count    INTEGER      NOT NULL DEFAULT 0,
      created_at_src  TIMESTAMPTZ,
      first_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_synced_at  TIMESTAMPTZ,
      last_event_at   TIMESTAMPTZ,
      deleted_at      TIMESTAMPTZ,
      PRIMARY KEY (instance_id, tenant_id)
    )
  `);

  await adminPool.query(`
    CREATE INDEX IF NOT EXISTS idx_tenants_cache_instance
      ON tenants_cache (instance_id, last_seen_at DESC)
  `);
  await adminPool.query(`
    CREATE INDEX IF NOT EXISTS idx_tenants_cache_slug
      ON tenants_cache (slug)
  `);
  await adminPool.query(`
    CREATE INDEX IF NOT EXISTS idx_tenants_cache_status
      ON tenants_cache (status) WHERE deleted_at IS NULL
  `);
  await adminPool.query(`
    CREATE INDEX IF NOT EXISTS idx_tenants_cache_tenant_lookup
      ON tenants_cache (tenant_id)
  `);
}
