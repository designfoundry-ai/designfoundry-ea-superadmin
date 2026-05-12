// Smoke coverage for the Stripe webhook. This is a public endpoint —
// authentication is the HMAC-SHA256 signature alone — so the signature
// verification path is the single point of trust. Pin:
//   - missing / malformed / wrong-secret signatures are rejected
//   - a correctly-signed payload is accepted
//   - subscription.deleted maps to a tenant status update
//
// We use jest.isolateModules in the helper so a module-load-time read of
// STRIPE_WEBHOOK_SECRET (none exists today, but defensive) wouldn't trip
// across tests.

import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';

const dbQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => dbQuery(...args) },
}));

// Use jest.fn() (no impl) so the inferred mock call signature is
// (...args: any[]) => any — required for the rest-spread forwarders below
// to satisfy TypeScript. Default behavior is configured in beforeEach.
const signLicense = jest.fn();
const planDefaults = jest.fn();
jest.mock('@/lib/license', () => ({
  __esModule: true,
  signLicense: (...args: unknown[]) => signLicense(...args),
  planDefaults: (...args: unknown[]) => planDefaults(...args),
}));

// Minimal but-structurally-valid JWT so the route's `JSON.parse(b64(payload))`
// succeeds. Real signing is exercised in license-signing.test.ts.
const STUB_LICENSE_JWT = [
  Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ jti: 'jti-test' })).toString('base64url'),
  'sig',
].join('.');

const STUB_PLAN_DEFAULTS = {
  maxUsers: 25,
  maxObjects: 1000,
  features: ['core'],
};

import { POST } from '@/app/api/webhooks/stripe/route';

const WEBHOOK_SECRET = 'whsec_test_super_secret';

function signedRequest(body: string, secret = WEBHOOK_SECRET, timestamp?: number): NextRequest {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const payload = `${ts}.${body}`;
  const v1 = createHmac('sha256', secret).update(payload).digest('hex');
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': `t=${ts},v1=${v1}`,
    },
    body,
  });
}

function unsignedRequest(body: string, header = ''): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (header) headers['stripe-signature'] = header;
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers,
    body,
  });
}

const ORIGINAL_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

beforeEach(() => {
  dbQuery.mockReset();
  signLicense.mockReset();
  signLicense.mockReturnValue(STUB_LICENSE_JWT);
  planDefaults.mockReset();
  planDefaults.mockReturnValue(STUB_PLAN_DEFAULTS);
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

describe('POST /api/webhooks/stripe', () => {
  it('rejects requests with no stripe-signature header (400) when secret is configured', async () => {
    const res = await POST(unsignedRequest(JSON.stringify({ type: 'ping' })));
    expect(res.status).toBe(400);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('rejects requests signed with the wrong secret (400)', async () => {
    const body = JSON.stringify({ type: 'customer.subscription.updated', data: { object: {} } });
    const res = await POST(signedRequest(body, 'whsec_wrong_secret'));
    expect(res.status).toBe(400);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('rejects requests with a malformed signature header (400)', async () => {
    const res = await POST(
      unsignedRequest(JSON.stringify({ type: 'ping' }), 'this-is-not-a-stripe-signature'),
    );
    expect(res.status).toBe(400);
  });

  it('skips signature verification when STRIPE_WEBHOOK_SECRET is the placeholder', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_placeholder';
    const res = await POST(
      unsignedRequest(JSON.stringify({ type: 'ping' })),
    );
    // No signature header at all — but secret is the placeholder, so we
    // bypass verification entirely and acknowledge the (unknown) event.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ received: true });
  });

  it('acknowledges an unknown event type with a correctly signed body', async () => {
    const body = JSON.stringify({ type: 'unknown.event.type', data: { object: {} } });
    const res = await POST(signedRequest(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ received: true });
    // No DB writes for unhandled events.
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('updates tenant status on customer.subscription.deleted', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const body = JSON.stringify({
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_xyz', status: 'canceled' } },
    });
    const res = await POST(signedRequest(body));
    expect(res.status).toBe(200);

    expect(dbQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = dbQuery.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE tenants SET status = 'cancelled'/);
    expect(String(sql)).toMatch(/is_active\s*=\s*false/);
    expect(params).toEqual(['cus_xyz']);
  });

  it('returns 500 when the body is valid signature but unparseable JSON', async () => {
    const body = '{ not json';
    const res = await POST(signedRequest(body));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.message).toMatch(/Webhook processing failed/i);
  });
});
