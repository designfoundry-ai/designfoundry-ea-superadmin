// Tenant detail — live from the owning instance, with cache fallback.
//
// GET resolves the tenant's instance via tenants_cache (PK is
// instance_id + tenant_id; tenant_id alone is usually unique across
// instances, but if two instances both claim the same id we accept
// ?instance=<UUID> to disambiguate). It then calls
// /api/v1/platform/tenants/{id} on that instance and merges the live
// stats with the cache metadata. Includes a _freshness block so the
// UI can show "live from <instance>" vs "cache fallback from N min ago".
//
// PATCH and DELETE are NOT YET migrated to the multi-instance model —
// they used to mutate a local `tenants` table that no longer exists
// as a source of truth. They now respond 501 with a clear message so
// the UI fails loudly instead of silently corrupting state.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, AuthError } from '@/lib/auth';
import {
  InstanceApiError,
  getTenantDetail,
} from '@/lib/services/instance-api-client';
import {
  type CachedTenant,
  findTenantByIdAnywhere,
  getCachedTenant,
} from '@/lib/services/tenants-cache';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireAdmin(req);
    const { id } = await params;

    const url = new URL(req.url);
    const instanceHint = url.searchParams.get('instance');

    const cached = await resolveCachedRow(id, instanceHint);
    if (!cached) {
      return NextResponse.json(
        { message: 'Tenant not found in any instance cache' },
        { status: 404 },
      );
    }

    // Best-effort live fetch. Falls back to cache so the page is never blank.
    try {
      const live = await getTenantDetail(cached.instanceId, cached.tenantId);
      return NextResponse.json({
        ...toApiShape(cached),
        usersCount: live.userCount,
        objectsCount: live.objectCount,
        primaryEmail: live.users?.[0]?.email ?? '',
        users: live.users ?? [],
        _freshness: {
          source: 'live',
          fetchedAt: new Date().toISOString(),
          instance: { id: cached.instanceId, name: cached.instanceName },
        },
      });
    } catch (err) {
      const reason =
        err instanceof InstanceApiError
          ? { code: err.code, message: err.message, status: err.status }
          : {
              code: 'INTERNAL',
              message: err instanceof Error ? err.message : 'unknown error',
            };
      return NextResponse.json({
        ...toApiShape(cached),
        users: [],
        _freshness: {
          source: 'cache_fallback',
          fetchedAt: new Date().toISOString(),
          instance: { id: cached.instanceId, name: cached.instanceName },
          cacheAge: {
            lastSyncedAt: cached.lastSyncedAt,
            lastEventAt: cached.lastEventAt,
          },
          error: reason,
        },
      });
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    console.error('[tenant GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export function PATCH() {
  // TODO(multi-instance): proxy to {instance}/api/v1/platform/tenants/{id}
  // via instance-api-client once it supports mutations. Until then this
  // endpoint cannot safely apply tenant edits.
  return NextResponse.json(
    {
      message:
        'Tenant edits via superadmin are not yet wired through to the owning instance. Edit the tenant directly on the EA instance.',
      code: 'NOT_IMPLEMENTED',
    },
    { status: 501 },
  );
}

export function DELETE() {
  // TODO(multi-instance): proxy to {instance}/api/v1/platform/tenants/{id}
  return NextResponse.json(
    {
      message:
        'Tenant deletion via superadmin is not yet wired through to the owning instance. Delete the tenant directly on the EA instance.',
      code: 'NOT_IMPLEMENTED',
    },
    { status: 501 },
  );
}

async function resolveCachedRow(
  tenantId: string,
  instanceHint: string | null,
): Promise<CachedTenant | null> {
  if (instanceHint) {
    return getCachedTenant(instanceHint, tenantId);
  }
  const matches = await findTenantByIdAnywhere(tenantId);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  // Ambiguous — prefer a non-deleted match; otherwise return the first.
  const live = matches.find((m) => m.deletedAt === null);
  return live ?? matches[0];
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
    diagramsCount: 0,
    mrr: 0,
    storageUsedMb: 0,
    primaryEmail: '',
    createdAt: t.createdAtSrc ?? t.firstSeenAt,
    lastActiveAt: t.lastEventAt ?? t.lastSeenAt,
    firstSeenAt: t.firstSeenAt,
    lastSeenAt: t.lastSeenAt,
    lastSyncedAt: t.lastSyncedAt,
    lastEventAt: t.lastEventAt,
    deletedAt: t.deletedAt,
  };
}
