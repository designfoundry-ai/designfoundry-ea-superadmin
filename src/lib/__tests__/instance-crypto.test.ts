// Smoke coverage for the AES-256-GCM helpers that protect every tenant's
// instance API key at rest in the admin DB. A silent regression here would
// brick every tenant's outbound calls — pin the encrypt → decrypt roundtrip
// and the tamper-detection paths.

import {
  generateApiKey,
  hashApiKey,
  encryptApiKey,
  decryptApiKey,
} from '@/lib/instance-crypto';

describe('lib/instance-crypto', () => {
  it('generateApiKey produces a "dfp_"-prefixed token', () => {
    const key = generateApiKey();
    expect(key.startsWith('dfp_')).toBe(true);
    // base64url of 32 random bytes ≈ 43 chars → total ≈ 47
    expect(key.length).toBeGreaterThanOrEqual(40);
    // No padding / non-url-safe chars after the prefix
    expect(key.slice(4)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashApiKey is deterministic and 64 hex chars (SHA-256)', () => {
    const plaintext = 'dfp_example';
    const h1 = hashApiKey(plaintext);
    const h2 = hashApiKey(plaintext);
    expect(h1).toEqual(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('encryptApiKey → decryptApiKey roundtrip recovers the plaintext', () => {
    const plaintext = generateApiKey();
    const blob = encryptApiKey(plaintext);
    expect(blob.split(':')).toHaveLength(3); // iv:tag:ct
    expect(decryptApiKey(blob)).toEqual(plaintext);
  });

  it('decryptApiKey rejects tampered ciphertext (auth-tag flip)', () => {
    const blob = encryptApiKey('dfp_secret');
    const [iv, tag, ct] = blob.split(':');
    // Flip a byte in the GCM auth tag — that's the exact mechanism whose
    // job is to detect tampering, so this is the strictest check we can run
    // without coordinating against the cipher's internal padding.
    const tagBuf = Buffer.from(tag, 'base64');
    tagBuf[0] = tagBuf[0] ^ 0xff;
    const tampered = [iv, tagBuf.toString('base64'), ct].join(':');
    expect(() => decryptApiKey(tampered)).toThrow();
  });

  it('decryptApiKey rejects malformed blobs', () => {
    expect(() => decryptApiKey('only-one-segment')).toThrow(/invalid format/);
    expect(() => decryptApiKey('a:b')).toThrow(/invalid format/);
  });
});
