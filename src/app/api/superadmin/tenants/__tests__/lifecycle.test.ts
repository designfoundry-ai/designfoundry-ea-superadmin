// Smoke coverage for tenant lifecycle endpoints — suspend + activate.
// Post-refactor: superadmin no longer mutates a local tenants table.
// It looks up the owning instance via tenants_cache and proxies the
// call to {instance}/api/v1/platform/tenants/:id/{suspend|activate}.
// Tests mock the proxy layer.

import { NextRequest } from 'next/server';

const findTenantByIdAnywhere = jest.fn();
const getCachedTenant = jest.fn();
const upsertTenant = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/services/tenants-cache', () => ({
  __esModule: true,
  findTenantByIdAnywhere: (...args: unknown[]) => findTenantByIdAnywhere(...args),
  getCachedTenant: (...args: unknown[]) => getCachedTenant(...args),
  upsertTenant: (...args: unknown[]) => upsertTenant(...args),
}));

const suspendTenantOnInstance = jest.fn();
const activateTenantOnInstance = jest.fn();
jest.mock('@/lib/services/instance-api-client', () => {
  const actual = jest.requireActual('@/lib/services/instance-api-client');
  return {
    __esModule: true,
    ...actual,
    suspendTenantOnInstance: (...args: unknown[]) => suspendTenantOnInstance(...args),
    activateTenantOnInstance: (...args: unknown[]) => activateTenantOnInstance(...args),
  };
});

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
const cachedRow = {
  instanceId: 'inst-1',
  instanceName: 'acme-prod',
  instanceEnvironment: 'production',
  tenantId: 't-1',
  name: 'Acme',
  slug: 'acme',
  status: 'active',
  plan: 'professional',
  userCount: 5,
  objectCount: 100,
  createdAtSrc: '2026-01-01T00:00:00Z',
  firstSeenAt: '2026-01-01T00:00:00Z',
  lastSeenAt: '2026-05-17T00:00:00Z',
  lastSyncedAt: '2026-05-17T00:00:00Z',
  lastEventAt: null,
  deletedAt: null,
};
const liveTenantPayload = {
  id: 't-1',
  name: 'Acme',
  slug: 'acme',
  status: 'suspended',
  userCount: 5,
  objectCount: 100,
  createdAt: '2026-01-01T00:00:00Z',
  users: [],
};

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
  findTenantByIdAnywhere.mockReset();
  getCachedTenant.mockReset();
  upsertTenant.mockClear();
  suspendTenantOnInstance.mockReset();
  activateTenantOnInstance.mockReset();
  logAudit.mockClear();
});

describe('POST /api/superadmin/tenants/[id]/suspend', () => {
  it('returns 401 when no admin is authenticated', async () => {
    requireAdmin.mockImplementationOnce(() => { throw new AuthError('Unauthorized'); });
    const res = await suspend(req(), ctx('t-1'));
    expect(res.status).toBe(401);
    expect(findTenantByIdAnywhere).not.toHaveBeenCalled();
  });

  it('returns 404 when the tenant is not in the cache (sync needed)', async () => {
    findTenantByIdAnywhere.mockResolvedValueOnce([]);
    const res = await suspend(req(), ctx('t-missing'));
    expect(res.status).toBe(404);
    expect(suspendTenantOnInstance).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('proxies to the owning instance and writes TENANT_SUSPENDED audit on success', async () => {
    findTenantByIdAnywhere.mockResolvedValueOnce([cachedRow]);
    suspendTenantOnInstance.mockResolvedValueOnce({ ...liveTenantPayload, status: 'suspended' });

    const res = await suspend(req(), ctx('t-1'));
    expect(res.status).toBe(200);

    expect(suspendTenantOnInstance).toHaveBeenCalledWith('inst-1', 't-1');
    expect(upsertTenant).toHaveBeenCalledWith(expect.objectContaining({
      instanceId: 'inst-1',
      tenantId: 't-1',
      status: 'suspended',
      source: 'event',
    }));

    expect(logAudit).toHaveBeenCalledTimes(1);
    const [actorId, actorEmail, action, target, targetId, details] = logAudit.mock.calls[0];
    expect(actorId).toBe(adminUser.id);
    expect(actorEmail).toBe(adminUser.email);
    expect(action).toBe('TENANT_SUSPENDED');
    expect(target).toBe('tenant');
    expect(targetId).toBe('t-1');
    expect(details).toMatchObject({ name: 'Acme', instanceId: 'inst-1' });
  });
});

describe('POST /api/superadmin/tenants/[id]/activate', () => {
  it('returns 401 when no admin is authenticated', async () => {
    requireAdmin.mockImplementationOnce(() => { throw new AuthError('Unauthorized'); });
    const res = await activate(req(), ctx('t-1'));
    expect(res.status).toBe(401);
    expect(findTenantByIdAnywhere).not.toHaveBeenCalled();
  });

  it('returns 404 when the tenant is not in the cache', async () => {
    findTenantByIdAnywhere.mockResolvedValueOnce([]);
    const res = await activate(req(), ctx('t-missing'));
    expect(res.status).toBe(404);
    expect(activateTenantOnInstance).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('proxies to the owning instance and writes TENANT_ACTIVATED audit on success', async () => {
    findTenantByIdAnywhere.mockResolvedValueOnce([cachedRow]);
    activateTenantOnInstance.mockResolvedValueOnce({ ...liveTenantPayload, status: 'active' });

    const res = await activate(req(), ctx('t-1'));
    expect(res.status).toBe(200);

    expect(activateTenantOnInstance).toHaveBeenCalledWith('inst-1', 't-1');
    expect(upsertTenant).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      source: 'event',
    }));
    expect(logAudit.mock.calls[0][2]).toBe('TENANT_ACTIVATED');
  });
});
