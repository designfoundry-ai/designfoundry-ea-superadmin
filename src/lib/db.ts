import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

const FALLBACK_DEV_URL =
  'postgresql://design_foundry:design_foundry@localhost:5432/designfoundry_admin';

function pickUrl(name: 'DATABASE_URL' | 'ADMIN_DATABASE_URL'): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function createPool(): Pool {
  // The superadmin's tenants/licenses/audit/settings data lives in the same
  // dedicated PostgreSQL database used by the instance registry, so when
  // DATABASE_URL isn't explicitly set we fall back to ADMIN_DATABASE_URL.
  const connectionString =
    pickUrl('DATABASE_URL') ?? pickUrl('ADMIN_DATABASE_URL') ?? FALLBACK_DEV_URL;

  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

// Reuse pool across hot-reloads in development
const pool = global._pgPool ?? createPool();
if (process.env.NODE_ENV !== 'production') global._pgPool = pool;

export default pool;
