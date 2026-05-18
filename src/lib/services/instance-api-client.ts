import { getDecryptedKeys, getInstance } from './instance-registry';

const DEFAULT_TIMEOUT_MS = 5000;
const PLATFORM_KEY_HEADER = 'X-Platform-Key';

export class InstanceApiError extends Error {
  constructor(
    message: string,
    public code:
      | 'TIMEOUT'
      | 'NETWORK'
      | 'UNAUTHORIZED'
      | 'NOT_FOUND'
      | 'BAD_RESPONSE'
      | 'NO_KEY',
    public status?: number,
  ) {
    super(message);
    this.name = 'InstanceApiError';
  }
}

export interface PlatformHealth {
  status: 'ok' | string;
  version?: string;
  uptimeSeconds?: number;
  db?: 'up' | 'down';
}

export interface PlatformTenantSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  userCount: number;
  objectCount: number;
  createdAt: string;
}

export interface PlatformTenantList {
  tenants: PlatformTenantSummary[];
  total: number;
}

export interface PlatformTenantDetail extends PlatformTenantSummary {
  users: PlatformUserSummary[];
}

export interface PlatformUserSummary {
  id: string;
  email: string;
  name?: string;
  tenantId: string;
  role?: string;
  status: string;
  lastLoginAt?: string;
  createdAt: string;
}

export interface PlatformUserList {
  users: PlatformUserSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface PlatformStats {
  tenantCount: number;
  userCount: number;
  objectCount: number;
  diagramCount: number;
}

export interface PlatformSystem {
  version: string;
  uptimeSeconds: number;
  db: { status: string; connections?: { current: number; max: number } };
  errorRate?: number;
  requestsPerMin?: number;
}

interface CallOptions {
  /** Use the pending key instead of the active key (for verifying a rotation). */
  pending?: boolean;
  timeoutMs?: number;
  query?: Record<string, string | number | undefined>;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

async function call<T>(
  instanceId: string,
  path: string,
  opts: CallOptions = {},
): Promise<{ data: T; latencyMs: number }> {
  const instance = await getInstance(instanceId);
  if (instance.status === 'deactivated') {
    throw new InstanceApiError('instance is deactivated', 'NO_KEY');
  }

  const keys = await getDecryptedKeys(instanceId);
  const key = opts.pending ? keys.pending : keys.active;
  if (!key) {
    throw new InstanceApiError(
      opts.pending
        ? 'no pending key available for this instance'
        : 'instance has no active key',
      'NO_KEY',
    );
  }

  const method = opts.method ?? 'GET';
  const url = buildUrl(instance.url, path, opts.query);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const headers: Record<string, string> = {
    [PLATFORM_KEY_HEADER]: key,
    Accept: 'application/json',
  };
  let bodyPayload: string | undefined;
  if (opts.body !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    bodyPayload = JSON.stringify(opts.body);
  }

  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: bodyPayload,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw new InstanceApiError('request timed out', 'TIMEOUT');
    }
    throw new InstanceApiError(
      `network error: ${err instanceof Error ? err.message : 'unknown'}`,
      'NETWORK',
    );
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - start;

  if (response.status === 401 || response.status === 403) {
    throw new InstanceApiError('platform key rejected', 'UNAUTHORIZED', response.status);
  }
  if (response.status === 404) {
    throw new InstanceApiError(
      'tenant or platform endpoint not found on this instance',
      'NOT_FOUND',
      404,
    );
  }
  if (!response.ok) {
    let serverMsg: string | undefined;
    try {
      const errBody = await response.json();
      serverMsg = typeof errBody?.message === 'string' ? errBody.message : undefined;
    } catch {
      /* non-JSON body */
    }
    throw new InstanceApiError(
      serverMsg ?? `instance returned ${response.status}`,
      'BAD_RESPONSE',
      response.status,
    );
  }

  if (response.status === 204) {
    return { data: undefined as T, latencyMs };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new InstanceApiError('instance returned non-JSON body', 'BAD_RESPONSE');
  }

  return { data: body as T, latencyMs };
}

function buildUrl(
  base: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const u = new URL(`/api/v1${path}`, base + '/');
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'AbortError'
  );
}

export async function getHealth(
  instanceId: string,
  opts: { pending?: boolean } = {},
): Promise<{ data: PlatformHealth; latencyMs: number }> {
  return call<PlatformHealth>(instanceId, '/platform/health', opts);
}

export async function getTenants(instanceId: string): Promise<PlatformTenantList> {
  const { data } = await call<PlatformTenantList>(instanceId, '/platform/tenants');
  return data;
}

export async function getTenantDetail(
  instanceId: string,
  tenantId: string,
): Promise<PlatformTenantDetail> {
  const { data } = await call<PlatformTenantDetail>(
    instanceId,
    `/platform/tenants/${tenantId}`,
  );
  return data;
}

export async function getStats(instanceId: string): Promise<PlatformStats> {
  const { data } = await call<PlatformStats>(instanceId, '/platform/stats');
  return data;
}

export async function getUsers(
  instanceId: string,
  query: { page?: number; limit?: number; tenantId?: string } = {},
): Promise<PlatformUserList> {
  const { data } = await call<PlatformUserList>(instanceId, '/platform/users', {
    query,
  });
  return data;
}

export async function getSystem(instanceId: string): Promise<PlatformSystem> {
  const { data } = await call<PlatformSystem>(instanceId, '/platform/system');
  return data;
}

// ─── Mutations (proxy targets for superadmin lifecycle routes) ────────

export interface UpdateTenantInput {
  name?: string;
  plan?: string;
  status?: string;
}

export async function suspendTenantOnInstance(
  instanceId: string,
  tenantId: string,
): Promise<PlatformTenantDetail> {
  const { data } = await call<PlatformTenantDetail>(
    instanceId,
    `/platform/tenants/${tenantId}/suspend`,
    { method: 'POST' },
  );
  return data;
}

export async function activateTenantOnInstance(
  instanceId: string,
  tenantId: string,
): Promise<PlatformTenantDetail> {
  const { data } = await call<PlatformTenantDetail>(
    instanceId,
    `/platform/tenants/${tenantId}/activate`,
    { method: 'POST' },
  );
  return data;
}

export async function updateTenantOnInstance(
  instanceId: string,
  tenantId: string,
  input: UpdateTenantInput,
): Promise<PlatformTenantDetail> {
  const { data } = await call<PlatformTenantDetail>(
    instanceId,
    `/platform/tenants/${tenantId}`,
    { method: 'PATCH', body: input },
  );
  return data;
}

export async function getUsersForTenant(
  instanceId: string,
  tenantId: string,
  query: { page?: number; limit?: number } = {},
): Promise<PlatformUserList> {
  const { data } = await call<PlatformUserList>(instanceId, '/platform/users', {
    query: { ...query, tenantId },
  });
  return data;
}
