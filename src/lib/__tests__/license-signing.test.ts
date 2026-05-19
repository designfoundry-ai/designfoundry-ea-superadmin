// Smoke coverage for the RSA signing path of license issuance.
// signLicense produces the JWT every downstream EA instance verifies before
// honoring a license, so a regression here either silently issues unverifiable
// licenses (blocks every customer) or weakens the signature (security).

import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import { signLicense, type LicensePayload } from '@/lib/license';

let privateKeyPem: string;
let publicKeyPem: string;

const ORIGINAL_RSA_PRIVATE_KEY = process.env.RSA_PRIVATE_KEY;
const ORIGINAL_LICENSE_KEY_ID = process.env.LICENSE_KEY_ID;

const samplePayload: LicensePayload = {
  customerId: 'tenant-acme',
  customerName: 'Acme Corp',
  tenantSlug: 'acme',
  plan: 'enterprise',
  maxUsers: -1,
  maxObjects: -1,
  features: ['core', 'audit'],
  addons: [],
  deliveryModel: 'on_prem',
};

beforeAll(() => {
  // 2048-bit RSA keygen takes ~200ms in Node 20+; well within test budget
  // and matches the production key size, so we exercise the actual code path.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKeyPem = privateKey;
  publicKeyPem = publicKey;

  process.env.RSA_PRIVATE_KEY = privateKeyPem;
  process.env.LICENSE_KEY_ID = 'test-2026-01';
});

afterAll(() => {
  if (ORIGINAL_RSA_PRIVATE_KEY === undefined) delete process.env.RSA_PRIVATE_KEY;
  else process.env.RSA_PRIVATE_KEY = ORIGINAL_RSA_PRIVATE_KEY;
  if (ORIGINAL_LICENSE_KEY_ID === undefined) delete process.env.LICENSE_KEY_ID;
  else process.env.LICENSE_KEY_ID = ORIGINAL_LICENSE_KEY_ID;
});

describe('lib/license — signLicense', () => {
  it('produces a JWT verifiable with the matching public key (RS256)', () => {
    const token = signLicense(samplePayload);

    // jsonwebtoken's verify, restricted to RS256, is the canonical check —
    // it covers signature validity, algorithm pinning, and decoding.
    const decoded = jwt.verify(token, publicKeyPem, {
      algorithms: ['RS256'],
    }) as jwt.JwtPayload;

    expect(decoded.customerId).toBe(samplePayload.customerId);
    expect(decoded.customerName).toBe(samplePayload.customerName);
    expect(decoded.tenantSlug).toBe(samplePayload.tenantSlug);
    expect(decoded.plan).toBe(samplePayload.plan);
    expect(decoded.features).toEqual(samplePayload.features);
    // baseFeatures alias is the field name the rezonator reads off the JWT.
    expect(decoded.baseFeatures).toEqual(samplePayload.features);
    expect(decoded.iss).toBe('designfoundry-superadmin');
    expect(typeof decoded.jti).toBe('string');
  });

  it('includes the configured key id in the JWT header (for rotation)', () => {
    const token = signLicense(samplePayload);
    const headerJson = Buffer.from(token.split('.')[0], 'base64url').toString();
    const header = JSON.parse(headerJson);
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe('test-2026-01');
  });

  it('rejects tokens signed with a different RSA key', () => {
    const token = signLicense(samplePayload);
    const { publicKey: wrongKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    expect(() =>
      jwt.verify(token, wrongKey, { algorithms: ['RS256'] }),
    ).toThrow();
  });

  it('rejects tampered tokens (flipped payload byte)', () => {
    const token = signLicense(samplePayload);
    const [header, payload, signature] = token.split('.');
    // Flip a byte inside the payload base64; signature now won't match.
    const tampered = [
      header,
      payload.slice(0, -1) + (payload.slice(-1) === 'A' ? 'B' : 'A'),
      signature,
    ].join('.');

    expect(() =>
      jwt.verify(tampered, publicKeyPem, { algorithms: ['RS256'] }),
    ).toThrow();
  });

  it('honors the expiresAt argument by emitting a matching exp claim', () => {
    const fiveMinutes = 5 * 60 * 1000;
    const expiresAt = new Date(Date.now() + fiveMinutes);
    const token = signLicense(samplePayload, expiresAt);

    const decoded = jwt.verify(token, publicKeyPem, {
      algorithms: ['RS256'],
    }) as jwt.JwtPayload;

    expect(decoded.exp).toBeDefined();
    const expMs = (decoded.exp as number) * 1000;
    // ±2s tolerance for clock skew between sign and assert.
    expect(Math.abs(expMs - expiresAt.getTime())).toBeLessThan(2000);
  });

  it('rejects RS256 tokens when verified with the wrong algorithm whitelist', () => {
    const token = signLicense(samplePayload);
    // A common misconfiguration — accepting HS256 alongside RS256 — would
    // let an attacker forge tokens using the public key as the HMAC secret.
    // verify with algorithms: ['HS256'] should refuse the RS256 token.
    expect(() =>
      jwt.verify(token, publicKeyPem, { algorithms: ['HS256'] }),
    ).toThrow();
  });
});
