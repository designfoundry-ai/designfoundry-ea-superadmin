// Smoke coverage for the deterministic bits of license issuance.
// signLicense itself needs an RSA private key + filesystem state; testing
// it properly requires a fixture key pair (separate ticket). For now we
// pin planDefaults() and the .lic envelope format — both consumed by the
// downstream EA instances and easy to break with a renaming/typo.

import { planDefaults, toLicFile } from '@/lib/license';

describe('lib/license', () => {
  describe('planDefaults', () => {
    it('returns the named plan when known', () => {
      expect(planDefaults('free').features).toEqual(['core']);
      expect(planDefaults('team').maxUsers).toBe(25);
      expect(planDefaults('professional').maxObjects).toBe(5000);
      expect(planDefaults('enterprise').features).toContain('audit');
    });

    it('falls back to the free plan for unknown plan keys', () => {
      expect(planDefaults('nonexistent-plan')).toEqual(planDefaults('free'));
    });

    it('enterprise plan uses -1 sentinels for unlimited limits', () => {
      const ent = planDefaults('enterprise');
      expect(ent.maxUsers).toBe(-1);
      expect(ent.maxObjects).toBe(-1);
    });
  });

  describe('toLicFile', () => {
    it('wraps the JWT in the BEGIN/END envelope with base64 body', () => {
      const jwt = 'header.payload.signature';
      const lic = toLicFile(jwt);

      expect(lic).toMatch(/^-----BEGIN DESIGNFOUNDRY LICENSE-----\n/);
      expect(lic).toMatch(/\n-----END DESIGNFOUNDRY LICENSE-----\n$/);

      const body = lic
        .split('\n')
        .filter((line) => line && !line.startsWith('-----'))
        .join('');
      expect(Buffer.from(body, 'base64').toString('utf8')).toEqual(jwt);
    });
  });
});
