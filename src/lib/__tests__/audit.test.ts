// Smoke coverage for the audit-log writer. Every superadmin write path
// fires logAudit; a regression that drops rows, mis-shapes the INSERT, or
// crashes on a DB failure would either lose forensic data or break the
// outer operation (which the function is explicitly designed not to do).

const dbQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => dbQuery(...args) },
}));

import { logAudit } from '@/lib/audit';

beforeEach(() => {
  dbQuery.mockReset();
});

describe('lib/audit — logAudit', () => {
  it('issues an INSERT with the 7 expected positional params (details stringified)', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [] });

    await logAudit(
      'admin-1',
      'op@designfoundry.ai',
      'TENANT_SUSPENDED',
      'tenant',
      'tenant-42',
      { name: 'Acme', reason: 'fraud' },
      '10.0.0.1',
    );

    expect(dbQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = dbQuery.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO admin_audit_log/);
    expect(params).toHaveLength(7);
    expect(params).toEqual([
      'admin-1',
      'op@designfoundry.ai',
      'TENANT_SUSPENDED',
      'tenant',
      'tenant-42',
      JSON.stringify({ name: 'Acme', reason: 'fraud' }),
      '10.0.0.1',
    ]);
  });

  it('passes null for details when the caller omits them — never the string "null"', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [] });

    await logAudit('a', 'a@designfoundry.ai', 'X', null, null, null, null);

    const [, params] = dbQuery.mock.calls[0];
    expect(params[5]).toBeNull();
    expect(params[5]).not.toBe('null'); // would silently store the string "null" as JSONB
  });

  it('swallows DB failures silently — audit must never break the outer op', async () => {
    dbQuery.mockRejectedValueOnce(new Error('connection refused'));

    await expect(
      logAudit('a', 'a@designfoundry.ai', 'X', 't', 't1', { k: 1 }, '1.1.1.1'),
    ).resolves.toBeUndefined();
  });

  it('targets the platform DB pool (not the admin DB pool)', async () => {
    // The audit log lives in the shared platform DB next to tenants/licenses,
    // not in the admin DB next to instances/super_admins. Verified indirectly
    // here by mocking @/lib/db — if the source file ever switched to
    // @/lib/admin-db, this test's spy would not be called.
    dbQuery.mockResolvedValueOnce({ rows: [] });

    await logAudit('a', 'a@designfoundry.ai', 'X', 't', 't1', null, null);

    expect(dbQuery).toHaveBeenCalledTimes(1);
  });
});
