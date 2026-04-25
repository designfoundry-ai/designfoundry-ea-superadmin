import pool from './db';

let initialized = false;

export async function initDb(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      license_id      VARCHAR(64) NOT NULL UNIQUE,
      tenant_id       UUID REFERENCES tenants(id) ON DELETE SET NULL,
      customer_name   VARCHAR(255) NOT NULL,
      contact_email   VARCHAR(255) NOT NULL,
      delivery_model  VARCHAR(16) NOT NULL DEFAULT 'saas',
      plan            VARCHAR(32) NOT NULL,
      addons          JSONB NOT NULL DEFAULT '[]',
      features        JSONB NOT NULL DEFAULT '[]',
      max_users       INTEGER NOT NULL DEFAULT 5,
      max_objects     INTEGER NOT NULL DEFAULT 100,
      issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at      TIMESTAMPTZ,
      license_blob    TEXT NOT NULL,
      key_id          VARCHAR(64) NOT NULL DEFAULT 'dev-2026-01',
      status          VARCHAR(16) NOT NULL DEFAULT 'active',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_licenses_tenant ON licenses(tenant_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status)
  `);
}
