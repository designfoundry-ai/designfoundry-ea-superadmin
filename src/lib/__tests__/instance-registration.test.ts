// R1-16 unit coverage for the self-registration service.
//
// TC4 — idempotent register: a second registerOrUpsert() with the same
// instanceId must NOT issue a new apiKey, must NOT change url/environment,
// and must return isNew=false.
//
// TC9 — bootstrap-token rotation: verifyRegistrationToken honors whatever
// PLATFORM_REGISTRATION_TOKEN holds at call time, and recordHeartbeat is
// independent of that token entirely (per-instance API key only).

// Force TS to treat this file as a module (not a script) so top-level
// `const query` does not collide with admin-db-init.test.ts's same-named
// top-level binding under a flat tsconfig.
export {};

const query = jest.fn();

jest.mock('@/lib/admin-db', () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => query(...args) },
}));

jest.mock('@/lib/admin-db-init', () => ({
  __esModule: true,
  initAdminDb: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/instance-crypto', () => ({
  __esModule: true,
  generateApiKey: jest.fn(() => 'dfp_test-fixed-api-key'),
  encryptApiKey: jest.fn(() => 'enc::dfp_test-fixed-api-key'),
  hashApiKey: jest.fn((plain: string) => `hash::${plain}`),
}));

const ORIGINAL_TOKEN = process.env.PLATFORM_REGISTRATION_TOKEN;

beforeEach(() => {
  query.mockReset();
  jest.resetModules();
  process.env.PLATFORM_REGISTRATION_TOKEN = 'token-A';
});

afterAll(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.PLATFORM_REGISTRATION_TOKEN;
  } else {
    process.env.PLATFORM_REGISTRATION_TOKEN = ORIGINAL_TOKEN;
  }
});

function makeRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-05-17T10:00:00Z');
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'inst-A',
    url: 'http://localhost:3001',
    environment: 'dev',
    api_key_encrypted: 'enc::dfp_test-fixed-api-key',
    api_key_hash: 'hash::dfp_test-fixed-api-key',
    pending_api_key_encrypted: null,
    pending_api_key_hash: null,
    status: 'active',
    last_health_check: null,
    last_health_status: null,
    instance_version: null,
    key_rotated_at: null,
    deactivated_at: null,
    registration_source: 'self_registered',
    first_registered_at: now,
    last_heartbeat_at: null,
    approved_by: null,
    approved_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('TC4 — registerOrUpsert idempotency', () => {
  it('first call issues apiKey + isNew=true; second call returns null + isNew=false with no url/env change', async () => {
    const { registerOrUpsert } = await import(
      '@/lib/services/instance-registration'
    );

    const input = {
      instanceId: '11111111-1111-1111-1111-111111111111',
      name: 'inst-A',
      url: 'http://localhost:3001',
      environment: 'dev' as const,
      registrationToken: 'token-A',
    };

    // First call — SELECT returns 0 rows → INSERT returns the new row.
    query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [makeRow()] });

    const first = await registerOrUpsert(input);

    expect(first.isNew).toBe(true);
    expect(first.apiKey).toBe('dfp_test-fixed-api-key');
    expect(first.instance.url).toBe('http://localhost:3001');
    expect(first.instance.environment).toBe('dev');

    // Second call — SELECT returns the existing row → UPDATE returns same row.
    query
      .mockResolvedValueOnce({ rowCount: 1, rows: [makeRow()] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [makeRow()] });

    const second = await registerOrUpsert(input);

    expect(second.isNew).toBe(false);
    expect(second.apiKey).toBeNull();
    expect(second.instance.url).toBe(first.instance.url);
    expect(second.instance.environment).toBe(first.instance.environment);
    expect(second.instance.id).toBe(first.instance.id);

    // No second INSERT — only SELECT + UPDATE on the second call.
    const stmts = query.mock.calls.map(([sql]) => String(sql));
    expect(stmts.filter((s) => /^\s*INSERT INTO instances/i.test(s))).toHaveLength(1);
    expect(stmts.filter((s) => /^\s*UPDATE instances/i.test(s))).toHaveLength(1);
  });
});

describe('TC9 — bootstrap token rotation', () => {
  it('verifyRegistrationToken accepts current token and rejects others, even across rotation', async () => {
    const { verifyRegistrationToken } = await import(
      '@/lib/services/instance-registration'
    );

    process.env.PLATFORM_REGISTRATION_TOKEN = 'token-A';
    expect(() => verifyRegistrationToken('token-A')).not.toThrow();
    expect(() => verifyRegistrationToken('token-B')).toThrow(/invalid/i);
    expect(() => verifyRegistrationToken('')).toThrow(/invalid/i);

    // Rotate. Re-read happens per-call via process.env, so no module reload needed.
    process.env.PLATFORM_REGISTRATION_TOKEN = 'token-B';
    expect(() => verifyRegistrationToken('token-B')).not.toThrow();
    expect(() => verifyRegistrationToken('token-A')).toThrow(/invalid/i);
  });

  it('throws INVALID_STATE when PLATFORM_REGISTRATION_TOKEN is unset', async () => {
    delete process.env.PLATFORM_REGISTRATION_TOKEN;
    const { verifyRegistrationToken } = await import(
      '@/lib/services/instance-registration'
    );
    expect(() => verifyRegistrationToken('anything')).toThrow(/not configured/i);
  });

  it('recordHeartbeat succeeds independent of PLATFORM_REGISTRATION_TOKEN', async () => {
    const { recordHeartbeat } = await import(
      '@/lib/services/instance-registration'
    );

    // No bootstrap token at all — heartbeat must still work.
    delete process.env.PLATFORM_REGISTRATION_TOKEN;

    const row = makeRow();
    query
      .mockResolvedValueOnce({ rowCount: 1, rows: [row] }) // lookup by hash
      .mockResolvedValueOnce({ rowCount: 1, rows: [row] }); // UPDATE refresh

    const result = await recordHeartbeat({
      apiKeyHash: 'hash::dfp_test-fixed-api-key',
    });

    expect(result.instance.id).toBe(row.id);
    expect(result.heartbeatIntervalSec).toBe(60);

    // First query is a SELECT by api_key_hash; nothing references the bootstrap token.
    const [firstSql, firstParams] = query.mock.calls[0];
    expect(String(firstSql)).toMatch(/api_key_hash/);
    expect(firstParams).toEqual(['hash::dfp_test-fixed-api-key']);
  });
});
