// Smoke coverage for the @designfoundry.ai domain gate at the login route.
// This is layer 2 of the two-layer auth model (CLAUDE.md) and the only
// place the domain check is enforced at the app level — pin it.

import { NextRequest } from 'next/server';

// jest.mock factories are hoisted above the const declarations, so we
// reference the spies via lazy lambdas to defer the lookup past TDZ.
const dbQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => dbQuery(...args) },
}));

const compare = jest.fn();
jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: { compare: (...args: unknown[]) => compare(...args) },
  compare: (...args: unknown[]) => compare(...args),
}));

import { POST } from '@/app/api/auth/login/route';

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  dbQuery.mockReset();
  compare.mockReset();
});

describe('POST /api/auth/login', () => {
  it('rejects requests with missing email or password (400)', async () => {
    const res = await POST(postRequest({ email: 'alice@designfoundry.ai' }));
    expect(res.status).toBe(400);
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('rejects non-@designfoundry.ai emails with 403 before touching the DB', async () => {
    const res = await POST(
      postRequest({ email: 'alice@example.com', password: 'whatever' }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/designfoundry\.ai/);
    expect(dbQuery).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
  });

  it('returns 401 (not 404) when a @designfoundry.ai user does not exist', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(
      postRequest({ email: 'ghost@designfoundry.ai', password: 'x' }),
    );
    expect(res.status).toBe(401);
    // Generic message — must not leak whether the email exists.
    const body = await res.json();
    expect(body.message).not.toMatch(/not found|no such user/i);
  });

  it('returns 401 on bad password and never signs a token', async () => {
    dbQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', email: 'alice@designfoundry.ai', password_hash: 'hash' }],
    });
    compare.mockResolvedValueOnce(false);

    const res = await POST(
      postRequest({ email: 'alice@designfoundry.ai', password: 'wrong' }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.token).toBeUndefined();
  });
});
