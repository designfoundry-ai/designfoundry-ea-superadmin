// Smoke coverage for tenant lifecycle endpoints — suspend + activate.
// These are the two transitions that change a tenant's billing/access
// state, so a regression here either fails to revoke access on suspend
// or fails to restore it on activate. Plus the audit hook must fire.

import { NextRequest } from 'next/server';

const dbQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => dbQuery(...args) },
}));

const requireAdmin = jest.fn();
const getClientIp = jest.fn().mockReturnValue('127.0.0.1');
jest.mock('@/lib/auth', () => {
  const actual = jest.requireActual('@/lib/auth');
  return {
    __esModule: true,
    ...actual,
    requireAdmin: (...args: unknown[]) => requireAdmin(...args),
    getClientIp: (...args: unknown[]) => getClientIp(...args),
  };
});

const logAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/audit', () => ({
  __esModule: true,
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

import { POST as suspend } from '@/app/api/superadmin/tenants/[id]/suspend/route';
import { POST as activate } from '@/app/api/superadmin/tenants/[id]/activate/route';
import { AuthError } from '@/lib/auth';

const adminUser = { id: 'admin-1', email: 'op@designfoundry.ai' };

function req(): NextRequest {
  return new NextRequest('http://localhost/api/superadmin/tenants/t-1/x', {
    method: 'POST',
  });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  requireAdmin.mockReturnValue(adminUser);
  dbQuery.mockReset();
  logAudit.mockClear();
});

describe('POST /api/superadmin/tenants/[id]/suspend', () => {
  it('returns 401 when no admin is authenticated', async () => {
    requireAdmin.mockImplementationOnce(() => {
      throw new AuthError('Unauthorized');
    });

    const res = await suspend(req(), ctx('t-1'));
    expect(res.status).toBe(401);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('returns 404 when the tenant does not exist (no UPDATE returning)', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await suspend(req(), ctx('t-missing'));
    expect(res.status).toBe(404);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('returns 200, UPDATEs the row, and writes a TENANT_SUSPENDED audit on success', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [{ name: 'Acme' }], rowCount: 1 });

    const res = await suspend(req(), ctx('t-1'));
    expect(res.status).toBe(200);

    // SQL pins the suspended state + deactivation flag for the tenant.
    const [sql, params] = dbQuery.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE tenants SET status = 'suspended'/);
    expect(String(sql)).toMatch(/is_active\s*=\s*false/);
    expect(params).toEqual(['t-1']);

    // Audit hook fired with the tenant name from the RETURNING clause.
    expect(logAudit).toHaveBeenCalledTimes(1);
    const [actorId, actorEmail, action, target, targetId, details] = logAudit.mock.calls[0];
    expect(actorId).toBe(adminUser.id);
    expect(actorEmail).toBe(adminUser.email);
    expect(action).toBe('TENANT_SUSPENDED');
    expect(target).toBe('tenant');
    expect(targetId).toBe('t-1');
    expect(details).toEqual({ name: 'Acme' });
  });
});

describe('POST /api/superadmin/tenants/[id]/activate', () => {
  it('returns 401 when no admin is authenticated', async () => {
    requireAdmin.mockImplementationOnce(() => {
      throw new AuthError('Unauthorized');
    });

    const res = await activate(req(), ctx('t-1'));
    expect(res.status).toBe(401);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('returns 404 when the tenant does not exist', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await activate(req(), ctx('t-missing'));
    expect(res.status).toBe(404);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('returns 200, restores the row, and writes a TENANT_ACTIVATED audit on success', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [{ name: 'Acme' }], rowCount: 1 });

    const res = await activate(req(), ctx('t-1'));
    expect(res.status).toBe(200);

    const [sql, params] = dbQuery.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE tenants SET status = 'active'/);
    expect(String(sql)).toMatch(/is_active\s*=\s*true/);
    expect(params).toEqual(['t-1']);

    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit.mock.calls[0][2]).toBe('TENANT_ACTIVATED');
  });
});
