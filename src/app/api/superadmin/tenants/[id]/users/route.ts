// Proxy: GET /api/superadmin/tenants/:id/users
//   → GET {instance}/api/v1/platform/users?tenantId=:id
//
// Looks up the owning instance from tenants_cache, fans out to that
// instance's /platform/users endpoint with a tenantId filter. Returns
// the standard UserList shape so the existing UI keeps working.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, AuthError } from '@/lib/auth';
import {
  InstanceApiError,
  getUsersForTenant,
} from '@/lib/services/instance-api-client';
import {
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

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '50', 10)));

    try {
      const live = await getUsersForTenant(cached.instanceId, cached.tenantId, {
        page,
        limit,
      });

      return NextResponse.json({
        users: live.users.map((u) => ({
          id: u.id,
          name: u.name ?? '',
          email: u.email,
          tenantId: id,
          tenantName: cached.name,
          role: u.role ?? '',
          status: u.status,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt,
        })),
        total: live.total,
        page: live.page,
        limit: live.limit,
      });
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
    console.error('[tenant users GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
