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
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      instance_id  UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      event_type   VARCHAR(64) NOT NULL,
      payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
      received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await adminPool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_events_instance
      ON platform_events (instance_id, received_at DESC)
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
