// Smoke coverage for the runtime DB initializer. CLAUDE.md calls out that
// scripts/init-admin-db.mjs and src/lib/admin-db-init.ts must stay in sync
// for the platform_events column set; the previous audit caught a 9-column
// drift between the two. Capture the SQL emitted by initAdminDb() so any
// future drift fails a test instead of silently shipping.

// Force TS to treat this file as a module so top-level `const query`
// does not leak into the global scope and collide with the same-named
// top-level binding in instance-registration.test.ts under flat tsconfig.
export {};

// jest.mock factories are hoisted above the const declarations; reference
// the spy via a lazy lambda to defer the lookup past TDZ.
const query = jest.fn().mockResolvedValue({ rows: [] });

jest.mock('@/lib/admin-db', () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => query(...args) },
}));

// initAdminDb caches its run-promise at module scope, so each test
// dynamically imports a fresh copy via require() after jest.resetModules().
// No top-level static import — that would just bind to a stale module copy.

beforeEach(() => {
  query.mockClear();
  jest.resetModules();
});

describe('lib/admin-db-init', () => {
  it('runs CREATE TABLE for the four core admin tables', async () => {
    const { initAdminDb: freshInit } = await import('@/lib/admin-db-init');
    await freshInit();

    const sqls = query.mock.calls.map(([sql]) => String(sql));
    const joined = sqls.join('\n---\n');

    for (const table of ['instances', 'platform_events', 'admin_audit_log', 'super_admins']) {
      expect(joined).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
    }
  });

  it('ensures pgcrypto is available before any CREATE TABLE', async () => {
    const { initAdminDb: freshInit } = await import('@/lib/admin-db-init');
    await freshInit();

    const sqls = query.mock.calls.map(([sql]) => String(sql));
    const pgcryptoIdx = sqls.findIndex((s) => /CREATE EXTENSION IF NOT EXISTS pgcrypto/.test(s));
    const firstCreateTableIdx = sqls.findIndex((s) => /CREATE TABLE IF NOT EXISTS/.test(s));

    expect(pgcryptoIdx).toBeGreaterThanOrEqual(0);
    expect(firstCreateTableIdx).toBeGreaterThan(pgcryptoIdx);
  });

  it('emits ALTER TABLE upgrade paths for every platform_events column added since v1', async () => {
    const { initAdminDb: freshInit } = await import('@/lib/admin-db-init');
    await freshInit();

    const sqls = query.mock.calls.map(([sql]) => String(sql)).join('\n');

    // The columns that scripts/init-admin-db.mjs is expected to mirror, per
    // the prior audit. If you add a column to platform_events, add it here
    // too — that's the contract.
    const newColumns = [
      'envelope_id',
      'tenant_id',
      'severity',
      'actor_user_id',
      'actor_email',
      'actor_ip_address',
      'event_timestamp',
      'schema_version',
      'signature_kid',
    ];

    for (const col of newColumns) {
      expect(sqls).toMatch(
        new RegExp(`ALTER TABLE platform_events ADD COLUMN IF NOT EXISTS\\s+${col}\\b`),
      );
    }
  });

  it('creates the three platform_events indexes', async () => {
    const { initAdminDb: freshInit } = await import('@/lib/admin-db-init');
    await freshInit();

    const sqls = query.mock.calls.map(([sql]) => String(sql)).join('\n');

    expect(sqls).toMatch(/idx_platform_events_instance\b/);
    expect(sqls).toMatch(/idx_platform_events_severity\b/);
    expect(sqls).toMatch(/idx_platform_events_event_type\b/);
  });
});
