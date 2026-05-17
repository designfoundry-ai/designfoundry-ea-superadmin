// R1-16 — Instance Self-Registration
//
// Distinct from instance-registry.ts (manual operator-driven creation).
// This service handles the instance-initiated handshake:
//   - registerOrUpsert(): idempotent on instanceId; only returns plaintext apiKey on first call
//   - recordHeartbeat(): authenticated by X-Instance-Key, refreshes liveness columns
//   - approveInstance() / rejectInstance(): operator gates production self-registrations

import { timingSafeEqual } from 'crypto';
import adminPool from '../admin-db';
import { initAdminDb } from '../admin-db-init';
import {
  encryptApiKey,
  generateApiKey,
  hashApiKey,
} from '../instance-crypto';
import {
  HealthStatus,
  Instance,
  InstanceEnvironment,
  InstanceStatus,
  InstanceRegistryError,
} from './instance-registry';

export const HEARTBEAT_INTERVAL_SEC = 60;

export type RegistrationSource = 'manual' | 'self_registered';

export interface RegisteredInstance extends Instance {
  registrationSource: RegistrationSource;
  firstRegisteredAt: string | null;
  lastHeartbeatAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface RegisterInput {
  instanceId: string;
  name: string;
  url: string;
  environment: InstanceEnvironment;
  version?: string | null;
  registrationToken: string;
}

export interface RegisterResult {
  instance: RegisteredInstance;
  apiKey: string | null; // null on idempotent re-registration
  heartbeatIntervalSec: number;
  isNew: boolean;
}

interface RegistrationRow {
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
  registration_source: RegistrationSource;
  first_registered_at: Date | null;
  last_heartbeat_at: Date | null;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toRegistered(row: RegistrationRow): RegisteredInstance {
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
    registrationSource: row.registration_source,
    firstRegisteredAt: row.first_registered_at?.toISOString() ?? null,
    lastHeartbeatAt: row.last_heartbeat_at?.toISOString() ?? null,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at?.toISOString() ?? null,
  };
}

function normaliseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function verifyRegistrationToken(token: string): void {
  const expected = process.env.PLATFORM_REGISTRATION_TOKEN;
  if (!expected) {
    throw new InstanceRegistryError(
      'PLATFORM_REGISTRATION_TOKEN not configured on superadmin',
      'INVALID_STATE',
    );
  }
  if (!token || !constantTimeEquals(token, expected)) {
    throw new InstanceRegistryError('invalid registration token', 'NO_KEY');
  }
}

export function isRegistrationEnabled(): boolean {
  return process.env.PLATFORM_REGISTRATION_ENABLED !== 'false';
}

function validateRegisterInput(input: RegisterInput): void {
  if (!input.instanceId || !isUuid(input.instanceId)) {
    throw new InstanceRegistryError(
      'instanceId must be a UUID',
      'INVALID_INPUT',
    );
  }
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
    throw new InstanceRegistryError(
      'url must be a valid http(s) URL',
      'INVALID_INPUT',
    );
  }
  if (!['production', 'staging', 'dev'].includes(input.environment)) {
    throw new InstanceRegistryError(
      'environment must be production | staging | dev',
      'INVALID_INPUT',
    );
  }
}

export async function registerOrUpsert(
  input: RegisterInput,
): Promise<RegisterResult> {
  if (!isRegistrationEnabled()) {
    throw new InstanceRegistryError(
      'self-registration is disabled',
      'INVALID_STATE',
    );
  }
  verifyRegistrationToken(input.registrationToken);
  validateRegisterInput(input);
  await initAdminDb();

  const url = normaliseUrl(input.url);
  const name = input.name.trim();
  const version = input.version?.trim() || null;

  const existing = await adminPool.query<RegistrationRow>(
    `SELECT * FROM instances WHERE id = $1`,
    [input.instanceId],
  );

  if (existing.rowCount && existing.rowCount > 0) {
    const row = existing.rows[0];
    if (row.url !== url) {
      throw new InstanceRegistryError(
        'instanceId already registered with a different URL',
        'INVALID_STATE',
      );
    }
    if (row.status === 'deactivated') {
      throw new InstanceRegistryError(
        'instance has been deactivated',
        'INVALID_STATE',
      );
    }
    const updated = await adminPool.query<RegistrationRow>(
      `UPDATE instances
          SET name             = $2,
              instance_version = COALESCE($3, instance_version),
              updated_at       = NOW()
        WHERE id = $1
        RETURNING *`,
      [input.instanceId, name, version],
    );
    return {
      instance: toRegistered(updated.rows[0]),
      apiKey: null,
      heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
      isNew: false,
    };
  }

  const apiKey = generateApiKey();
  const encrypted = encryptApiKey(apiKey);
  const hash = hashApiKey(apiKey);
  const initialStatus: InstanceStatus =
    input.environment === 'dev' ? 'active' : 'awaiting_approval';

  try {
    const inserted = await adminPool.query<RegistrationRow>(
      `INSERT INTO instances
         (id, name, url, environment,
          api_key_encrypted, api_key_hash,
          status, registration_source,
          first_registered_at, instance_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'self_registered', NOW(), $8)
       RETURNING *`,
      [
        input.instanceId,
        name,
        url,
        input.environment,
        encrypted,
        hash,
        initialStatus,
        version,
      ],
    );
    return {
      instance: toRegistered(inserted.rows[0]),
      apiKey,
      heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
      isNew: true,
    };
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

export interface HeartbeatInput {
  apiKeyHash: string;
  version?: string | null;
  uptimeSec?: number | null;
}

export interface HeartbeatResult {
  instance: RegisteredInstance;
  heartbeatIntervalSec: number;
}

export async function recordHeartbeat(
  input: HeartbeatInput,
): Promise<HeartbeatResult> {
  await initAdminDb();

  const found = await adminPool.query<RegistrationRow>(
    `SELECT * FROM instances
      WHERE api_key_hash = $1 OR pending_api_key_hash = $1
      LIMIT 1`,
    [input.apiKeyHash],
  );

  if (!found.rowCount) {
    throw new InstanceRegistryError('unknown instance key', 'NO_KEY');
  }

  const row = found.rows[0];
  if (row.status === 'deactivated') {
    throw new InstanceRegistryError(
      'instance is deactivated',
      'INVALID_STATE',
    );
  }

  const healthStatus: HealthStatus = 'healthy';
  const updated = await adminPool.query<RegistrationRow>(
    `UPDATE instances
        SET last_heartbeat_at  = NOW(),
            last_health_check  = NOW(),
            last_health_status = $2,
            instance_version   = COALESCE($3, instance_version),
            updated_at         = NOW()
      WHERE id = $1
      RETURNING *`,
    [row.id, healthStatus, input.version ?? null],
  );
  return {
    instance: toRegistered(updated.rows[0]),
    heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
  };
}

export async function approveInstance(
  id: string,
  approvedById: string,
): Promise<RegisteredInstance> {
  await initAdminDb();
  const updated = await adminPool.query<RegistrationRow>(
    `UPDATE instances
        SET status      = 'active',
            approved_by = $2,
            approved_at = NOW(),
            updated_at  = NOW()
      WHERE id = $1 AND status = 'awaiting_approval'
      RETURNING *`,
    [id, approvedById],
  );
  if (!updated.rowCount) {
    throw new InstanceRegistryError(
      'instance not found or not awaiting approval',
      'INVALID_STATE',
    );
  }
  return toRegistered(updated.rows[0]);
}

export async function rejectInstance(id: string): Promise<RegisteredInstance> {
  await initAdminDb();
  const updated = await adminPool.query<RegistrationRow>(
    `UPDATE instances
        SET status                    = 'deactivated',
            api_key_encrypted         = NULL,
            api_key_hash              = NULL,
            pending_api_key_encrypted = NULL,
            pending_api_key_hash      = NULL,
            deactivated_at            = NOW(),
            updated_at                = NOW()
      WHERE id = $1 AND status = 'awaiting_approval'
      RETURNING *`,
    [id],
  );
  if (!updated.rowCount) {
    throw new InstanceRegistryError(
      'instance not found or not awaiting approval',
      'INVALID_STATE',
    );
  }
  return toRegistered(updated.rows[0]);
}

export async function listAwaitingApproval(): Promise<RegisteredInstance[]> {
  await initAdminDb();
  const result = await adminPool.query<RegistrationRow>(
    `SELECT * FROM instances
      WHERE status = 'awaiting_approval'
      ORDER BY first_registered_at DESC NULLS LAST, created_at DESC`,
  );
  return result.rows.map(toRegistered);
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}
