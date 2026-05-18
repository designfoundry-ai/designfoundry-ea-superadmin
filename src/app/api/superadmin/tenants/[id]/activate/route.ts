// Proxy: POST /api/superadmin/tenants/:id/activate
//   → POST {instance}/api/v1/platform/tenants/:id/activate
//
// Mirror of suspend/route.ts — see comments there.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import {
  InstanceApiError,
  activateTenantOnInstance,
} from '@/lib/services/instance-api-client';
import {
  findTenantByIdAnywhere,
  getCachedTenant,
  upsertTenant,
} from '@/lib/services/tenants-cache';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;
    const url = new URL(req.url);
    const instanceHint = url.searchParams.get('instance');

    let cached;
    if (instanceHint) {
      cached = await getCachedTenant(instanceHint, id);
    } else {
      const matches = await findTenantByIdAnywhere(id);
      cached = matches.find((m) => m.deletedAt === null) ?? matches[0];
    }

    if (!cached) {
      return NextResponse.json(
        { message: 'Tenant not found in any instance cache — run Sync now first.' },
        { status: 404 },
      );
    }

    try {
      const live = await activateTenantOnInstance(cached.instanceId, cached.tenantId);

      await upsertTenant({
        instanceId: cached.instanceId,
        tenantId: cached.tenantId,
        name: live.name,
        slug: live.slug,
        status: 'active',
        plan: cached.plan,
        userCount: live.userCount,
        objectCount: live.objectCount,
        createdAtSrc: live.createdAt ?? cached.createdAtSrc,
        source: 'event',
      });

      await logAudit(
        admin.id,
        admin.email,
        'TENANT_ACTIVATED',
        'tenant',
        id,
        { name: live.name, instanceId: cached.instanceId },
        getClientIp(req),
      );

      return NextResponse.json({ success: true, status: 'active' });
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
    console.error('[tenant activate]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
