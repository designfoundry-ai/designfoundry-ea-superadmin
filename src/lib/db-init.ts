import pool from './db';

let initPromise: Promise<void> | null = null;

export function initDb(): Promise<void> {
  if (!initPromise) initPromise = run();
  return initPromise;
}

async function run(): Promise<void> {
  // Required for gen_random_uuid()
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  // Tenants — referenced by licenses (FK) and queried by stats / tenants /
  // users / activity routes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        VARCHAR(255) NOT NULL,
      slug        VARCHAR(63)  NOT NULL UNIQUE,
      plan        VARCHAR(32)  NOT NULL DEFAULT 'free',
      status      VARCHAR(16)  NOT NULL DEFAULT 'active',
      is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
      license_blob       TEXT,
      license_updated    TIMESTAMPTZ,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_blob    TEXT
  `);
  await pool.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_updated TIMESTAMPTZ
  `);

  // Licenses
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_licenses_tenant ON licenses(tenant_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status)`);

  // Platform-wide settings (key/value).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key         VARCHAR(64) PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Feature flags
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      key         VARCHAR(64) PRIMARY KEY,
      enabled     BOOLEAN NOT NULL DEFAULT FALSE,
      description TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Cross-tenant user-visible activity feed (events from per-tenant code).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_activity_log (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    UUID,
      tenant_slug  VARCHAR(63),
      user_email   VARCHAR(320),
      event_type   VARCHAR(64) NOT NULL,
      severity     VARCHAR(16) NOT NULL DEFAULT 'INFO',
      details      JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_activity_log_created
      ON platform_activity_log (created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_platform_activity_log_tenant
      ON platform_activity_log (tenant_id, created_at DESC)
  `);
}
