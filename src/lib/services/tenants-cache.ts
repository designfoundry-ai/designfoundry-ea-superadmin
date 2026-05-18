// tenants_cache service — superadmin's denormalised view of tenants
// that live on individual EA instances. See admin-db-init.ts for schema.
//
// Three writers: the sync endpoint (full pull from /api/v1/platform/tenants),
// the event-bus bridge (incremental updates on tenant.* events), and the
// instance-removal cascade (PostgreSQL FK). All UPSERTs are last-writer-wins
// on the (instance_id, tenant_id) PK.

import adminPool from '../admin-db';
import { initAdminDb } from '../admin-db-init';

export type CachedTenantStatus =
  | 'active'
  | 'trial'
  | 'suspended'
  | 'canceled'
  | 'cancelled'
  | 'unknown';

export interface CachedTenant {
  instanceId: string;
  instanceName: string;
  instanceEnvironment: string;
  tenantId: string;
  name: string;
  slug: string;
  status: CachedTenantStatus | string;
  plan: string | null;
  userCount: number;
  objectCount: number;
  createdAtSrc: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSyncedAt: string | null;
  lastEventAt: string | null;
  deletedAt: string | null;
}

export interface CachedTenantUpsert {
  instanceId: string;
  tenantId: string;
  name: string;
  slug: string;
  status: string;
  plan?: string | null;
  userCount?: number;
  objectCount?: number;
  createdAtSrc?: string | null;
  /** Source that wrote this row — controls which timestamp columns advance. */
  source: 'sync' | 'event';
}

export interface ListFilters {
  instanceId?: string;
  status?: string;
  plan?: string;
  search?: string;
  includeDeleted?: boolean;
  page?: number;
  limit?: number;
}

export interface ListResult {
  tenants: CachedTenant[];
  total: number;
  page: number;
  limit: number;
}

interface Row {
  instance_id: string;
  instance_name: string;
  instance_environment: string;
  tenant_id: string;
  name: string;
  slug: string;
  status: string;
  plan: string | null;
  user_count: number;
  object_count: number;
  created_at_src: Date | null;
  first_seen_at: Date;
  last_seen_at: Date;
  last_synced_at: Date | null;
  last_event_at: Date | null;
  deleted_at: Date | null;
}

function rowToCached(r: Row): CachedTenant {
  return {
    instanceId: r.instance_id,
    instanceName: r.instance_name,
    instanceEnvironment: r.instance_environment,
    tenantId: r.tenant_id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    plan: r.plan,
    userCount: r.user_count,
    objectCount: r.object_count,
    createdAtSrc: r.created_at_src?.toISOString() ?? null,
    firstSeenAt: r.first_seen_at.toISOString(),
    lastSeenAt: r.last_seen_at.toISOString(),
    lastSyncedAt: r.last_synced_at?.toISOString() ?? null,
    lastEventAt: r.last_event_at?.toISOString() ?? null,
    deletedAt: r.deleted_at?.toISOString() ?? null,
  };
}

const SELECT_BASE = `
  SELECT t.instance_id, i.name AS instance_name, i.environment AS instance_environment,
         t.tenant_id, t.name, t.slug, t.status, t.plan,
         t.user_count, t.object_count, t.created_at_src,
         t.first_seen_at, t.last_seen_at, t.last_synced_at,
         t.last_event_at, t.deleted_at
    FROM tenants_cache t
    JOIN instances i ON i.id = t.instance_id
`;

export async function upsertTenant(input: CachedTenantUpsert): Promise<CachedTenant> {
  await initAdminDb();
  const isSync = input.source === 'sync';
  const isEvent = input.source === 'event';

  await adminPool.query(
    `INSERT INTO tenants_cache
       (instance_id, tenant_id, name, slug, status, plan,
        user_count, object_count, created_at_src,
        first_seen_at, last_seen_at, last_synced_at, last_event_at)
     VALUES ($1, $2, $3, $4, $5, $6,
             COALESCE($7, 0), COALESCE($8, 0), $9,
             NOW(), NOW(),
             CASE WHEN $10::bool THEN NOW() ELSE NULL END,
             CASE WHEN $11::bool THEN NOW() ELSE NULL END)
     ON CONFLICT (instance_id, tenant_id) DO UPDATE
        SET name           = EXCLUDED.name,
            slug           = EXCLUDED.slug,
            status         = EXCLUDED.status,
            plan           = COALESCE(EXCLUDED.plan, tenants_cache.plan),
            user_count     = COALESCE(EXCLUDED.user_count, tenants_cache.user_count),
            object_count   = COALESCE(EXCLUDED.object_count, tenants_cache.object_count),
            created_at_src = COALESCE(EXCLUDED.created_at_src, tenants_cache.created_at_src),
            last_seen_at   = NOW(),
            last_synced_at = CASE WHEN $10::bool THEN NOW() ELSE tenants_cache.last_synced_at END,
            last_event_at  = CASE WHEN $11::bool THEN NOW() ELSE tenants_cache.last_event_at END,
            deleted_at     = NULL`,
    [
      input.instanceId,
      input.tenantId,
      input.name,
      input.slug,
      input.status,
      input.plan ?? null,
      input.userCount ?? null,
      input.objectCount ?? null,
      input.createdAtSrc ?? null,
      isSync,
      isEvent,
    ],
  );

  const refetched = await getCachedTenant(input.instanceId, input.tenantId);
  if (!refetched) {
    throw new Error('tenants_cache UPSERT succeeded but refetch returned no row');
  }
  return refetched;
}

export async function markDeleted(
  instanceId: string,
  tenantId: string,
): Promise<void> {
  await initAdminDb();
  await adminPool.query(
    `UPDATE tenants_cache
        SET deleted_at = NOW(),
            last_event_at = NOW()
      WHERE instance_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [instanceId, tenantId],
  );
}

export async function markMissingAsDeleted(
  instanceId: string,
  seenTenantIds: string[],
  scannedAt: Date,
): Promise<number> {
  await initAdminDb();
  if (seenTenantIds.length === 0) {
    const r = await adminPool.query(
      `UPDATE tenants_cache
          SET deleted_at = $2
        WHERE instance_id = $1
          AND (last_synced_at IS NULL OR last_synced_at < $2)
          AND deleted_at IS NULL`,
      [instanceId, scannedAt],
    );
    return r.rowCount ?? 0;
  }
  const placeholders = seenTenantIds.map((_, i) => `$${i + 3}`).join(',');
  const r = await adminPool.query(
    `UPDATE tenants_cache
        SET deleted_at = $2
      WHERE instance_id = $1
        AND tenant_id NOT IN (${placeholders})
        AND deleted_at IS NULL`,
    [instanceId, scannedAt, ...seenTenantIds],
  );
  return r.rowCount ?? 0;
}

export async function getCachedTenant(
  instanceId: string,
  tenantId: string,
): Promise<CachedTenant | null> {
  await initAdminDb();
  const r = await adminPool.query<Row>(
    `${SELECT_BASE} WHERE t.instance_id = $1 AND t.tenant_id = $2`,
    [instanceId, tenantId],
  );
  return r.rowCount && r.rowCount > 0 ? rowToCached(r.rows[0]) : null;
}

export async function findTenantByIdAnywhere(
  tenantId: string,
): Promise<CachedTenant[]> {
  await initAdminDb();
  const r = await adminPool.query<Row>(
    `${SELECT_BASE} WHERE t.tenant_id = $1`,
    [tenantId],
  );
  return r.rows.map(rowToCached);
}

export async function listTenants(filters: ListFilters = {}): Promise<ListResult> {
  await initAdminDb();
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(200, Math.max(1, filters.limit ?? 25));
  const offset = (page - 1) * limit;

  const conds: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (!filters.includeDeleted) conds.push(`t.deleted_at IS NULL`);
  if (filters.instanceId) { conds.push(`t.instance_id = $${idx++}`); params.push(filters.instanceId); }
  if (filters.status)     { conds.push(`t.status      = $${idx++}`); params.push(filters.status); }
  if (filters.plan)       { conds.push(`t.plan        = $${idx++}`); params.push(filters.plan); }
  if (filters.search) {
    conds.push(`(t.name ILIKE $${idx} OR t.slug ILIKE $${idx} OR i.name ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const totalRes = await adminPool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM tenants_cache t JOIN instances i ON i.id = t.instance_id ${where}`,
    params,
  );
  const total = parseInt(totalRes.rows[0]?.cnt ?? '0', 10);

  const rowsRes = await adminPool.query<Row>(
    `${SELECT_BASE} ${where} ORDER BY t.name ASC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset],
  );

  return {
    tenants: rowsRes.rows.map(rowToCached),
    total,
    page,
    limit,
  };
}

export interface CacheStaleness {
  totalRows: number;
  liveRows: number;
  deletedRows: number;
  oldestLastSyncedAt: string | null;
  newestLastSyncedAt: string | null;
  oldestLastEventAt: string | null;
  newestLastEventAt: string | null;
}

export async function getStaleness(): Promise<CacheStaleness> {
  await initAdminDb();
  const r = await adminPool.query<{
    total_rows: string;
    live_rows: string;
    deleted_rows: string;
    oldest_synced: Date | null;
    newest_synced: Date | null;
    oldest_event: Date | null;
    newest_event: Date | null;
  }>(
    `SELECT COUNT(*)::text                                            AS total_rows,
            COUNT(*) FILTER (WHERE deleted_at IS NULL)::text          AS live_rows,
            COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::text      AS deleted_rows,
            MIN(last_synced_at)                                       AS oldest_synced,
            MAX(last_synced_at)                                       AS newest_synced,
            MIN(last_event_at)                                        AS oldest_event,
            MAX(last_event_at)                                        AS newest_event
       FROM tenants_cache`,
  );
  const row = r.rows[0];
  return {
    totalRows: parseInt(row?.total_rows ?? '0', 10),
    liveRows: parseInt(row?.live_rows ?? '0', 10),
    deletedRows: parseInt(row?.deleted_rows ?? '0', 10),
    oldestLastSyncedAt: row?.oldest_synced?.toISOString() ?? null,
    newestLastSyncedAt: row?.newest_synced?.toISOString() ?? null,
    oldestLastEventAt: row?.oldest_event?.toISOString() ?? null,
    newestLastEventAt: row?.newest_event?.toISOString() ?? null,
  };
}
