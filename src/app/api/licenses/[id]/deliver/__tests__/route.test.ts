// Smoke coverage for the license re-delivery endpoint.
// This is a revenue-adjacent path: when a customer's instance loses /
// rejects a license, ops calls this to re-emit the signed JWT through
// the event bus. Pin happy path, auth, validation, and the event-bus
// error → HTTP status mapping (409 for inactive instance, 502/503 for
// transport / config issues).

import { NextRequest } from 'next/server';

// --- mock factories (lazy lambdas to dodge jest.mock hoist TDZ) ---

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

const deliverLicense = jest.fn();
jest.mock('@/lib/event-bus', () => {
  // Real EventBusError requires (message, code, ...) — recreate in-factory
  // so the route's `instanceof EventBusError` check still passes for our
  // mock-thrown errors, and tests can construct it with the same shape.
  class EventBusError extends Error {
    constructor(message: string, public code: string) {
      super(message);
      this.name = 'EventBusError';
    }
  }
  return {
    __esModule: true,
    EventBusService: { deliverLicense: (...args: unknown[]) => deliverLicense(...args) },
    EventBusError,
  };
});
import { EventBusError } from '@/lib/event-bus';

import { POST } from '@/app/api/licenses/[id]/deliver/route';
import { AuthError } from '@/lib/auth';

const adminUser = { id: 'admin-1', email: 'op@designfoundry.ai' };

function jsonPost(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/licenses/lic-1/deliver', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Route handler signature: (req, { params: Promise<{ id }> })
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const baseLicenseRow = {
  license_id: 'jti-abc',
  tenant_id: 'tenant-1',
  tenant_slug: 'acme',
  delivery_model: 'saas',
  plan: 'professional',
  features: ['core', 'collaboration'],
  max_users: 100,
  max_objects: 5000,
  expires_at: '2027-01-01T00:00:00.000Z',
  license_blob: 'header.payload.signature',
  status: 'active',
};

beforeEach(() => {
  requireAdmin.mockReturnValue(adminUser);
  dbQuery.mockReset();
  logAudit.mockClear();
  deliverLicense.mockReset();
});

describe('POST /api/licenses/[id]/deliver', () => {
  it('returns 401 when no admin is authenticated', async () => {
    requireAdmin.mockImplementationOnce(() => {
      throw new AuthError('Unauthorized');
    });

    const res = await POST(jsonPost({ instanceId: 'inst-1' }), ctx('lic-1'));
    expect(res.status).toBe(401);
    expect(dbQuery).not.toHaveBeenCalled();
    expect(deliverLicense).not.toHaveBeenCalled();
  });

  it('returns 400 when instanceId is missing from the body', async () => {
    const res = await POST(jsonPost({}), ctx('lic-1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/instanceId/);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('returns 404 when the license does not exist', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(
      jsonPost({ instanceId: 'inst-1' }),
      ctx('lic-missing'),
    );
    expect(res.status).toBe(404);
    expect(deliverLicense).not.toHaveBeenCalled();
  });

  it('returns 400 when the license is on_prem (not deliverable via event bus)', async () => {
    dbQuery.mockResolvedValueOnce({
      rows: [{ ...baseLicenseRow, delivery_model: 'on_prem' }],
    });

    const res = await POST(jsonPost({ instanceId: 'inst-1' }), ctx('lic-1'));
    expect(res.status).toBe(400);
    expect(deliverLicense).not.toHaveBeenCalled();
  });

  it('returns 400 when the license is revoked', async () => {
    dbQuery.mockResolvedValueOnce({
      rows: [{ ...baseLicenseRow, status: 'revoked' }],
    });

    const res = await POST(jsonPost({ instanceId: 'inst-1' }), ctx('lic-1'));
    expect(res.status).toBe(400);
    expect(deliverLicense).not.toHaveBeenCalled();
  });

  it('returns 200 with envelopeId on happy path and writes an audit row', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [baseLicenseRow] });
    deliverLicense.mockResolvedValueOnce({
      ok: true,
      envelopeId: 'env-xyz',
      mode: 'http',
    });

    const res = await POST(jsonPost({ instanceId: 'inst-1' }), ctx('lic-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, envelopeId: 'env-xyz', mode: 'http' });

    // EventBusService payload includes the license JWT, tenant slug, and
    // features array. Field name is `jwt` (was `licenseBlob` historically —
    // renamed to match the rezonator bridge contract).
    const [arg] = deliverLicense.mock.calls[0];
    expect(arg.instanceId).toBe('inst-1');
    expect(arg.payload.jwt).toBe(baseLicenseRow.license_blob);
    expect(arg.payload.tenantSlug).toBe(baseLicenseRow.tenant_slug);
    expect(arg.payload.licenseId).toBe(baseLicenseRow.license_id);
    expect(arg.payload.features).toEqual(baseLicenseRow.features);

    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit.mock.calls[0][2]).toBe('LICENSE_REDELIVERED');
  });

  it('maps EventBusError code=INSTANCE_INACTIVE to HTTP 409', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [baseLicenseRow] });
    deliverLicense.mockRejectedValueOnce(
      new EventBusError('instance is inactive', 'INSTANCE_INACTIVE'),
    );

    const res = await POST(jsonPost({ instanceId: 'inst-1' }), ctx('lic-1'));
    expect(res.status).toBe(409);
    expect(logAudit).not.toHaveBeenCalled(); // failure path skips audit
  });

  it('maps EventBusError code=CONFIG to HTTP 503', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [baseLicenseRow] });
    deliverLicense.mockRejectedValueOnce(
      new EventBusError('not configured', 'CONFIG'),
    );

    const res = await POST(jsonPost({ instanceId: 'inst-1' }), ctx('lic-1'));
    expect(res.status).toBe(503);
  });

  it('maps the TRANSPORT EventBusError code to HTTP 502 (catch-all)', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [baseLicenseRow] });
    deliverLicense.mockRejectedValueOnce(
      new EventBusError('upstream timeout', 'TRANSPORT'),
    );

    const res = await POST(jsonPost({ instanceId: 'inst-1' }), ctx('lic-1'));
    // The route maps INSTANCE_INACTIVE → 409, CONFIG/NO_SECRET → 503, else 502.
    expect(res.status).toBe(502);
  });
});
