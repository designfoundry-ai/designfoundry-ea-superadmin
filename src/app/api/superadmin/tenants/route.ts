// Superadmin tenants list — reads from tenants_cache (denormalised
// across instances). The cache is maintained by:
//   - /api/superadmin/tenants/sync (manual full pull from instances)
//   - the event-bus bridge (incremental on tenant.* events)
//
// Filters: instance_id, status, plan, search (matches name/slug/instance name).
// Pagination: page (1-based), limit (capped at 200).
//
// Response shape preserved for the existing UI: { tenants, total, page, limit }
// with each tenant carrying the previous fields plus instance metadata and
// freshness timestamps for the new freshness badge.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, AuthError } from '@/lib/auth';
import {
  type CachedTenant,
  getStaleness,
  listTenants,
} from '@/lib/services/tenants-cache';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '25', 10)));

    const result = await listTenants({
      page,
      limit,
      search: sp.get('search') ?? undefined,
      status: sp.get('status') ?? undefined,
      plan: sp.get('plan') ?? undefined,
      instanceId: sp.get('instance') ?? sp.get('instanceId') ?? undefined,
      includeDeleted: sp.get('includeDeleted') === 'true',
    });

    const staleness = await getStaleness();

    return NextResponse.json({
      tenants: result.tenants.map(toApiShape),
      total: result.total,
      page: result.page,
      limit: result.limit,
      cache: {
        liveRows: staleness.liveRows,
        deletedRows: staleness.deletedRows,
        newestSyncedAt: staleness.newestLastSyncedAt,
        oldestSyncedAt: staleness.oldestLastSyncedAt,
        newestEventAt: staleness.newestLastEventAt,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    console.error('[tenants GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

function toApiShape(t: CachedTenant) {
  return {
    id: t.tenantId,
    instanceId: t.instanceId,
    instanceName: t.instanceName,
    instanceEnvironment: t.instanceEnvironment,
    name: t.name,
    slug: t.slug,
    status: t.status,
    plan: t.plan ?? 'unknown',
    usersCount: t.userCount,
    objectsCount: t.objectCount,
    diagramsCount: 0, // No longer surfaced — cache doesn't track per-instance diagram count
    mrr: 0,           // Not derivable from instance API — keep field for UI compat
    storageUsedMb: 0, // Same — not derivable
    primaryEmail: '', // Fetched live on the detail page, not in the list
    createdAt: t.createdAtSrc ?? t.firstSeenAt,
    lastActiveAt: t.lastEventAt ?? t.lastSeenAt,
    firstSeenAt: t.firstSeenAt,
    lastSeenAt: t.lastSeenAt,
    lastSyncedAt: t.lastSyncedAt,
    lastEventAt: t.lastEventAt,
    deletedAt: t.deletedAt,
  };
}
