import adminPool from '../admin-db';
import { initAdminDb } from '../admin-db-init';
import {
  decryptApiKey,
  encryptApiKey,
  generateApiKey,
  hashApiKey,
} from '../instance-crypto';

export type InstanceEnvironment = 'production' | 'staging' | 'dev';

export type InstanceStatus =
  | 'pending'
  | 'active'
  | 'inactive'
  | 'deactivated';

export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface Instance {
  id: string;
  name: string;
  url: string;
  environment: InstanceEnvironment;
  status: InstanceStatus;
  lastHealthCheck: string | null;
  lastHealthStatus: HealthStatus | null;
  instanceVersion: string | null;
  hasPendingKey: boolean;
  keyRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstanceWithSecret extends Instance {
  apiKey: string;
}

export interface CreateInstanceInput {
  name: string;
  url: string;
  environment: InstanceEnvironment;
}

export class InstanceRegistryError extends Error {
  constructor(
    message: string,
    public code:
      | 'NOT_FOUND'
      | 'DUPLICATE_URL'
      | 'INVALID_INPUT'
      | 'INVALID_STATE'
      | 'NO_KEY',
  ) {
    super(message);
    this.name = 'InstanceRegistryError';
  }
}

interface InstanceRow {
  id: string;
  name: string;
  url: string;
  environment: InstanceEnvironment;
  api_key_encrypted: string | null;
  api_key_hash: string | null;
  pending_api_key_encrypted: string | null;
  pending_api_key_hash: string | null;
  status: InstanceStatus;
  last_health_check: Date | null;
  last_health_status: HealthStatus | null;
  instance_version: string | null;
  key_rotated_at: Date | null;
  deactivated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toInstance(row: InstanceRow): Instance {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    environment: row.environment,
    status: row.status,
    lastHealthCheck: row.last_health_check?.toISOString() ?? null,
    lastHealthStatus: row.last_health_status,
    instanceVersion: row.instance_version,
    hasPendingKey: row.pending_api_key_encrypted !== null,
    keyRotatedAt: row.key_rotated_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function normaliseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function validateInput(input: CreateInstanceInput): void {
  if (!input.name?.trim()) {
    throw new InstanceRegistryError('name is required', 'INVALID_INPUT');
  }
  if (!input.url?.trim()) {
    throw new InstanceRegistryError('url is required', 'INVALID_INPUT');
  }
  try {
    const u = new URL(input.url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error('bad protocol');
    }
  } catch {
    throw new InstanceRegistryError('url must be a valid http(s) URL', 'INVALID_INPUT');
  }
  if (!['production', 'staging', 'dev'].includes(input.environment)) {
    throw new InstanceRegistryError(
      'environment must be production | staging | dev',
      'INVALID_INPUT',
    );
  }
}

export async function createInstance(
  input: CreateInstanceInput,
): Promise<InstanceWithSecret> {
  validateInput(input);
  await initAdminDb();

  const url = normaliseUrl(input.url);
  const apiKey = generateApiKey();
  const encrypted = encryptApiKey(apiKey);
  const hash = hashApiKey(apiKey);

  try {
    const result = await adminPool.query<InstanceRow>(
      `INSERT INTO instances
         (name, url, environment, api_key_encrypted, api_key_hash, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [input.name.trim(), url, input.environment, encrypted, hash],
    );
    return { ...toInstance(result.rows[0]), apiKey };
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      throw new InstanceRegistryError(
        'instance with this URL already exists',
        'DUPLICATE_URL',
      );
    }
    throw err;
  }
}

export async function listInstances(): Promise<Instance[]> {
  await initAdminDb();
  const result = await adminPool.query<InstanceRow>(
    `SELECT * FROM instances
     WHERE status <> 'deactivated'
     ORDER BY created_at DESC`,
  );
  return result.rows.map(toInstance);
}

export async function getInstance(id: string): Promise<Instance> {
  await initAdminDb();
  const result = await adminPool.query<InstanceRow>(
    `SELECT * FROM instances WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) {
    throw new InstanceRegistryError('instance not found', 'NOT_FOUND');
  }
  return toInstance(result.rows[0]);
}

export async function getDecryptedKeys(id: string): Promise<{
  active: string | null;
  pending: string | null;
}> {
  await initAdminDb();
  const result = await adminPool.query<InstanceRow>(
    `SELECT * FROM instances WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) {
    throw new InstanceRegistryError('instance not found', 'NOT_FOUND');
  }
  const row = result.rows[0];
  return {
    active: row.api_key_encrypted ? decryptApiKey(row.api_key_encrypted) : null,
    pending: row.pending_api_key_encrypted
      ? decryptApiKey(row.pending_api_key_encrypted)
      : null,
  };
}

export async function recordHealthCheck(
  id: string,
  result: {
    ok: boolean;
    instanceVersion?: string | null;
  },
): Promise<Instance> {
  await initAdminDb();
  const status: HealthStatus = result.ok ? 'healthy' : 'unhealthy';
  const newRowStatus = result.ok ? 'active' : undefined;

  const updated = await adminPool.query<InstanceRow>(
    `UPDATE instances
        SET last_health_check  = NOW(),
            last_health_status = $2,
            instance_version   = COALESCE($3, instance_version),
            status             = COALESCE($4, status),
            updated_at         = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, status, result.instanceVersion ?? null, newRowStatus ?? null],
  );

  if (updated.rowCount === 0) {
    throw new InstanceRegistryError('instance not found', 'NOT_FOUND');
  }
  return toInstance(updated.rows[0]);
}

export async function rotateKey(id: string): Promise<{
  instance: Instance;
  apiKey: string;
}> {
  await initAdminDb();
  const apiKey = generateApiKey();
  const encrypted = encryptApiKey(apiKey);
  const hash = hashApiKey(apiKey);

  const updated = await adminPool.query<InstanceRow>(
    `UPDATE instances
        SET pending_api_key_encrypted = $2,
            pending_api_key_hash      = $3,
            updated_at                = NOW()
      WHERE id = $1 AND status <> 'deactivated'
      RETURNING *`,
    [id, encrypted, hash],
  );

  if (updated.rowCount === 0) {
    throw new InstanceRegistryError(
      'instance not found or deactivated',
      'NOT_FOUND',
    );
  }

  return { instance: toInstance(updated.rows[0]), apiKey };
}

export async function commitPendingKey(id: string): Promise<Instance> {
  await initAdminDb();
  const updated = await adminPool.query<InstanceRow>(
    `UPDATE instances
        SET api_key_encrypted         = pending_api_key_encrypted,
            api_key_hash              = pending_api_key_hash,
            pending_api_key_encrypted = NULL,
            pending_api_key_hash      = NULL,
            key_rotated_at            = NOW(),
            updated_at                = NOW()
      WHERE id = $1
        AND pending_api_key_encrypted IS NOT NULL
      RETURNING *`,
    [id],
  );
  if (updated.rowCount === 0) {
    throw new InstanceRegistryError('no pending key to commit', 'INVALID_STATE');
  }
  return toInstance(updated.rows[0]);
}

export async function deactivateInstance(id: string): Promise<void> {
  await initAdminDb();
  const result = await adminPool.query(
    `UPDATE instances
        SET status                    = 'deactivated',
            api_key_encrypted         = NULL,
            api_key_hash              = NULL,
            pending_api_key_encrypted = NULL,
            pending_api_key_hash      = NULL,
            deactivated_at            = NOW(),
            updated_at                = NOW()
      WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) {
    throw new InstanceRegistryError('instance not found', 'NOT_FOUND');
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}
