// Smoke coverage for the instance-creation endpoint. Mocks the registry
// service so we exercise the route's input validation, status-code mapping,
// audit hook, and response shape (which includes the one-time apiKey + a
// warning string) without touching the admin DB.

import { NextRequest } from 'next/server';

// --- mock factories (lazy lambdas to dodge jest.mock hoist TDZ) ---

const requireAdmin = jest.fn();
const getClientIp = jest.fn(() => '127.0.0.1');
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

const createInstance = jest.fn();
const listInstances = jest.fn();
// Re-export the real error class — the route uses instanceof to map codes.
jest.mock('@/lib/services/instance-registry', () => {
  const actual = jest.requireActual('@/lib/services/instance-registry');
  return {
    __esModule: true,
    ...actual,
    createInstance: (...args: unknown[]) => createInstance(...args),
    listInstances: (...args: unknown[]) => listInstances(...args),
  };
});

import { POST } from '@/app/api/superadmin/instances/route';
import { InstanceRegistryError } from '@/lib/services/instance-registry';
import { AuthError } from '@/lib/auth';

const adminUser = { id: 'admin-1', email: 'op@designfoundry.ai' };

function jsonPost(body: unknown, raw = false): NextRequest {
  return new NextRequest('http://localhost/api/superadmin/instances', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  requireAdmin.mockReturnValue(adminUser);
  createInstance.mockReset();
  logAudit.mockClear();
});

const instanceFixture = {
  id: 'inst-uuid-1',
  name: 'EU prod',
  url: 'https://ea.eu.example.test',
  environment: 'production',
  status: 'pending',
  lastHealthCheck: null,
  lastHealthStatus: null,
  instanceVersion: null,
  hasPendingKey: false,
  keyRotatedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  apiKey: 'dfp_TESTKEY_DO_NOT_USE',
};

describe('POST /api/superadmin/instances', () => {
  it('returns 401 when no admin is authenticated', async () => {
    requireAdmin.mockImplementationOnce(() => {
      throw new AuthError('Unauthorized');
    });

    const res = await POST(jsonPost({ name: 'X', url: 'https://x.test' }));
    expect(res.status).toBe(401);
    expect(createInstance).not.toHaveBeenCalled();
  });

  it('returns 400 for non-JSON body', async () => {
    const res = await POST(jsonPost('{ not json', true));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid JSON/i);
    expect(createInstance).not.toHaveBeenCalled();
  });

  it('returns 400 with INVALID_INPUT when registry validation fails', async () => {
    createInstance.mockImplementationOnce(() => {
      throw new InstanceRegistryError('name is required', 'INVALID_INPUT');
    });

    const res = await POST(jsonPost({ url: 'https://x.test' })); // missing name
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_INPUT');
    expect(body.error).toMatch(/name is required/);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('returns 409 when registry reports DUPLICATE_URL', async () => {
    createInstance.mockImplementationOnce(() => {
      throw new InstanceRegistryError('already exists', 'DUPLICATE_URL');
    });

    const res = await POST(
      jsonPost({ name: 'Dup', url: 'https://taken.test', environment: 'production' }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('DUPLICATE_URL');
  });

  it('returns 201 with the one-time apiKey + warning on success', async () => {
    createInstance.mockResolvedValueOnce(instanceFixture);

    const res = await POST(
      jsonPost({
        name: 'EU prod',
        url: 'https://ea.eu.example.test',
        environment: 'production',
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe(instanceFixture.id);
    expect(body.apiKey).toBe(instanceFixture.apiKey);
    // The warning is the only place callers learn the key is shown once;
    // a regression that drops it = silent key loss for the operator.
    expect(body.apiKeyWarning).toMatch(/will not be shown again/i);
    expect(body.apiKeyWarning).toMatch(/PLATFORM_ADMIN_API_KEY/);

    // Registry was called with normalized input — defaults applied where omitted.
    expect(createInstance).toHaveBeenCalledWith({
      name: 'EU prod',
      url: 'https://ea.eu.example.test',
      environment: 'production',
    });

    // Audit fired with the right action label + actor.
    expect(logAudit).toHaveBeenCalledTimes(1);
    const [actorId, actorEmail, action, target] = logAudit.mock.calls[0];
    expect(actorId).toBe(adminUser.id);
    expect(actorEmail).toBe(adminUser.email);
    expect(action).toBe('instance.created');
    expect(target).toBe('instance');
  });

  it("defaults environment to 'production' when omitted in the body", async () => {
    createInstance.mockResolvedValueOnce(instanceFixture);

    await POST(jsonPost({ name: 'X', url: 'https://x.test' }));

    expect(createInstance).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'production' }),
    );
  });
});
