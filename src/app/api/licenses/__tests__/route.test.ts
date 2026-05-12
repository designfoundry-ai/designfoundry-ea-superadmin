// Smoke coverage for the license-issuance endpoint. Stubs every collaborator
// (auth, pg, signLicense, audit, event bus) and verifies the route's
// validation + happy-path response shape. The RSA path itself is exercised
// in license-signing.test.ts.

import { NextRequest } from 'next/server';

// --- mock factories (lazy lambdas to dodge jest.mock hoist TDZ) ---

const dbQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => dbQuery(...args) },
}));

// Use jest.fn() (no impl) so the inferred mock call signature is
// (...args: any[]) => any — required for the rest-spread forwarders below
// to satisfy TypeScript.
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

const signLicense = jest.fn();
const planDefaults = jest.fn();
jest.mock('@/lib/license', () => ({
  __esModule: true,
  signLicense: (...args: unknown[]) => signLicense(...args),
  planDefaults: (...args: unknown[]) => planDefaults(...args),
}));

const logAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/audit', () => ({
  __esModule: true,
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

const deliverLicense = jest.fn();
jest.mock('@/lib/event-bus', () => ({
  __esModule: true,
  EventBusService: { deliverLicense: (...args: unknown[]) => deliverLicense(...args) },
  // The route's catch matches `err instanceof EventBusError || err instanceof Error`,
  // so the test can throw a plain Error and the same branch fires. Avoid
  // importing the real EventBusError type into this file — its constructor
  // signature is (message, code) and we don't care about the code path here.
  EventBusError: Error,
}));

import { POST } from '@/app/api/licenses/route';

const adminUser = { id: 'admin-1', email: 'op@designfoundry.ai' };

function jsonPost(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/licenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// jti needs to be readable from JWT payload — fabricate a minimal-shape JWT.
function fakeJwt(payload: object): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  return [b64({ alg: 'RS256', typ: 'JWT' }), b64(payload), 'sig'].join('.');
}

beforeEach(() => {
  requireAdmin.mockReturnValue(adminUser);
  planDefaults.mockReturnValue({
    maxUsers: 25,
    maxObjects: 1000,
    features: ['core', 'collaboration'],
  });
  signLicense.mockReturnValue(fakeJwt({ jti: 'jti-123' }));
  dbQuery.mockReset();
  logAudit.mockClear();
  deliverLicense.mockReset();
});

describe('POST /api/licenses', () => {
  it('returns 401 when no admin is authenticated', async () => {
    requireAdmin.mockImplementationOnce(() => {
      throw new (jest.requireActual('@/lib/auth').AuthError)('Unauthorized');
    });

    const res = await POST(
      jsonPost({ customerName: 'A', contactEmail: 'a@b.com', plan: 'team' }),
    );
    expect(res.status).toBe(401);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(jsonPost({ customerName: 'A' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/customerName.*contactEmail.*plan/);
    expect(signLicense).not.toHaveBeenCalled();
  });

  it('issues a license and returns 201 with the JWT + non-delivery info', async () => {
    // Two pool.query calls: tenants lookup (skipped, no tenantSlug) and INSERT.
    dbQuery.mockResolvedValueOnce({ rows: [{ id: 'license-uuid-1' }] });

    const res = await POST(
      jsonPost({
        customerName: 'Acme Corp',
        contactEmail: 'ops@acme.test',
        plan: 'team',
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe('license-uuid-1');
    expect(typeof body.licenseJwt).toBe('string');
    expect(body.delivery).toEqual({ attempted: false, ok: false });

    // The signing call carried the plan defaults from the mock.
    expect(signLicense).toHaveBeenCalledTimes(1);
    const [signed] = signLicense.mock.calls[0];
    expect(signed.plan).toBe('team');
    expect(signed.maxUsers).toBe(25);

    // INSERT was emitted with the resolved jti as license_id.
    const lastInsertCall = dbQuery.mock.calls.find(([sql]) =>
      /INSERT INTO licenses/.test(String(sql)),
    );
    expect(lastInsertCall).toBeDefined();
    expect(lastInsertCall![1][0]).toBe('jti-123'); // first INSERT param = jti

    // Audit log fired exactly once for the issuance (delivery not attempted).
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit.mock.calls[0][2]).toBe('LICENSE_GENERATED');
    expect(deliverLicense).not.toHaveBeenCalled();
  });

  it('does not attempt delivery when deliveryModel is not saas', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [{ id: 'lic-2' }] });

    await POST(
      jsonPost({
        customerName: 'Foo',
        contactEmail: 'x@y.test',
        plan: 'free',
        deliveryModel: 'on_prem',
        instanceId: 'inst-1', // even with instanceId, on_prem skips delivery
      }),
    );

    expect(deliverLicense).not.toHaveBeenCalled();
  });

  it('catches event-bus failures during saas delivery without failing the issuance', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [{ id: 'inst-row-x' }] }); // tenants lookup
    dbQuery.mockResolvedValueOnce({ rows: [{ id: 'lic-3' }] });       // INSERT
    dbQuery.mockResolvedValueOnce({ rows: [] });                       // UPDATE tenants
    deliverLicense.mockRejectedValueOnce(new Error('boom'));

    const res = await POST(
      jsonPost({
        customerName: 'Bar',
        contactEmail: 'x@y.test',
        plan: 'professional',
        tenantSlug: 'bar',
        deliveryModel: 'saas',
        instanceId: 'inst-1',
      }),
    );

    expect(res.status).toBe(201); // issuance still succeeds
    const body = await res.json();
    expect(body.delivery).toMatchObject({
      attempted: true,
      ok: false,
      error: 'boom',
    });
  });
});
