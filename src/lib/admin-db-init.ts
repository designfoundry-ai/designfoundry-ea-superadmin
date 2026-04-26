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
      status                      VARCHAR(16)  NOT NULL DEFAULT 'pending',
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
}
