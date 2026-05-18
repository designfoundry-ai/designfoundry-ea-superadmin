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
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import {
  InstanceApiError,
  getTenantDetail,
  updateTenantOnInstance,
} from '@/lib/services/instance-api-client';
import {
  type CachedTenant,
  findTenantByIdAnywhere,
  getCachedTenant,
  upsertTenant,
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

// PATCH: proxy to {instance}/api/v1/platform/tenants/:id with the
// instance's PlatformTenantsService accepting { name?, plan?, status? }.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;
    const url = new URL(req.url);
    const instanceHint = url.searchParams.get('instance');

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      plan?: string;
      status?: string;
    };

    const patch = {
      name: typeof body.name === 'string' ? body.name : undefined,
      plan: typeof body.plan === 'string' ? body.plan : undefined,
      status: typeof body.status === 'string' ? body.status : undefined,
    };
    if (!patch.name && !patch.plan && !patch.status) {
      return NextResponse.json(
        { message: 'No updatable fields provided' },
        { status: 400 },
      );
    }

    const cached = await resolveCachedRow(id, instanceHint);
    if (!cached) {
      return NextResponse.json(
        { message: 'Tenant not found in any instance cache — run Sync now first.' },
        { status: 404 },
      );
    }

    try {
      const live = await updateTenantOnInstance(
        cached.instanceId,
        cached.tenantId,
        patch,
      );

      await upsertTenant({
        instanceId: cached.instanceId,
        tenantId: cached.tenantId,
        name: live.name,
        slug: live.slug,
        status: live.status,
        plan: patch.plan ?? cached.plan,
        userCount: live.userCount,
        objectCount: live.objectCount,
        createdAtSrc: live.createdAt ?? cached.createdAtSrc,
        source: 'event',
      });

      await logAudit(
        admin.id,
        admin.email,
        'TENANT_UPDATED',
        'tenant',
        id,
        { changes: patch, instanceId: cached.instanceId },
        getClientIp(req),
      );

      return NextResponse.json(toApiShape({ ...cached, ...live }));
    } catch (err) {
      if (err instanceof InstanceApiError) {
        const status = err.status ?? (err.code === 'NOT_FOUND' ? 404 : 502);
        return NextResponse.json(
          { message: err.message, code: err.code, instanceId: cached.instanceId },
          { status },
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    console.error('[tenant PATCH]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export function DELETE() {
  // Hard delete intentionally NOT wired: rezonator's PlatformTenantsService
  // doesn't expose a delete method (would need to drop the tenant schema +
  // cascade users/objects/etc, which is dangerous from a remote API). Use
  // suspend instead, then delete on the instance directly.
  return NextResponse.json(
    {
      message:
        'Hard delete is not supported via the platform API. Suspend the tenant here, then delete it on the EA instance directly.',
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
