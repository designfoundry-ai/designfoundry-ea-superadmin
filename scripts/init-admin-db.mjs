#!/usr/bin/env node
import { Pool } from 'pg';

const url =
  process.env.ADMIN_DATABASE_URL ||
  'postgresql://design_foundry:design_foundry@localhost:5432/designfoundry_admin';

const pool = new Pool({ connectionString: url });

async function main() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await pool.query(`
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
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_instances_url_active
      ON instances (url) WHERE status <> 'deactivated'
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_instances_status ON instances (status)
  `);

  await pool.query(`
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

  // ALTER paths so existing databases created from the previous schema
  // pick up the new columns. Mirror src/lib/admin-db-init.ts exactly.
  await pool.query(`ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS envelope_id      VARCHAR(26) UNIQUE`);
  await pool.query(`ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS tenant_id        UUID`);
  await pool.query(`ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS severity         VARCHAR(16) NOT NULL DEFAULT 'info'`);
  await pool.query(`ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS actor_user_id    UUID`);
  await pool.query(`ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS actor_email      VARCHAR(320)`);
  await pool.query(`ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS actor_ip_address VARCHAR(64)`);
  await pool.query(`ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS event_timestamp  TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS schema_version   VARCHAR(8) NOT NULL DEFAULT '1'`);
  await pool.query(`ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS signature_kid    VARCHAR(64)`);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_events_instance
      ON platform_events (instance_id, received_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_events_severity
      ON platform_events (severity, received_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_events_event_type
      ON platform_events (event_type, received_at DESC)
  `);

  await pool.query(`
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
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created
      ON admin_audit_log (created_at DESC)
  `);

  await pool.query(`
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

  console.log('admin DB initialised at', url);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
