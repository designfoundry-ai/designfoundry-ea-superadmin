import { Pool } from 'pg';

declare global {
  var _adminPgPool: Pool | undefined;
}

const FALLBACK_DEV_URL =
  'postgresql://design_foundry:design_foundry@localhost:5432/designfoundry_admin';

function createPool(): Pool {
  const connectionString = process.env.ADMIN_DATABASE_URL ?? FALLBACK_DEV_URL;
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

const adminPool = global._adminPgPool ?? createPool();
if (process.env.NODE_ENV !== 'production') global._adminPgPool = adminPool;

export default adminPool;
