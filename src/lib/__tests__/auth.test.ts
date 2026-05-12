// Smoke coverage for the JWT helpers behind every superadmin endpoint.
// Critical because a regression here either silently lets unauthorized
// callers through or 401s every legitimate request.

import { NextRequest } from 'next/server';
import {
  signAdminToken,
  verifyAdminToken,
  getAdminFromRequest,
  requireAdmin,
  AuthError,
} from '@/lib/auth';

const user = { id: 'u-123', email: 'alice@designfoundry.ai' };

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/admin', { headers });
}

describe('lib/auth', () => {
  it('sign → verify roundtrip preserves id and email', () => {
    const token = signAdminToken(user);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT shape: header.payload.signature

    const decoded = verifyAdminToken(token);
    expect(decoded).toEqual(user);
  });

  it('verifyAdminToken throws on tampered token', () => {
    const token = signAdminToken(user);
    const tampered = token.slice(0, -3) + 'AAA';
    expect(() => verifyAdminToken(tampered)).toThrow();
  });

  it('getAdminFromRequest returns user for a valid Bearer header', () => {
    const token = signAdminToken(user);
    const req = makeRequest({ authorization: `Bearer ${token}` });
    expect(getAdminFromRequest(req)).toEqual(user);
  });

  it('getAdminFromRequest returns null when header is missing, malformed, or invalid', () => {
    expect(getAdminFromRequest(makeRequest({}))).toBeNull();
    expect(getAdminFromRequest(makeRequest({ authorization: 'Basic xyz' }))).toBeNull();
    expect(
      getAdminFromRequest(makeRequest({ authorization: 'Bearer not-a-jwt' })),
    ).toBeNull();
  });

  it('requireAdmin throws AuthError when no valid token is present', () => {
    expect(() => requireAdmin(makeRequest({}))).toThrow(AuthError);
  });
});
