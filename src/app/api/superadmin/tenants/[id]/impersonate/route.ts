import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;

    const tenantRow = await pool.query<{ name: string; slug: string }>(
      `SELECT name, slug FROM tenants WHERE id = $1 AND is_active = true`,
      [id],
    );
    if (!tenantRow.rows[0]) {
      return NextResponse.json({ message: 'Tenant not found or inactive' }, { status: 404 });
    }
    const { slug } = tenantRow.rows[0];

    // Get the system user for this tenant
    const userRow = await pool.query<{ id: string }>(
      `SELECT id FROM "t_${slug}".users WHERE is_system_account = true LIMIT 1`,
    );
    const systemUserId = userRow.rows[0]?.id;
    if (!systemUserId) {
      return NextResponse.json({ message: 'No system user for this tenant' }, { status: 400 });
    }

    await logAudit(admin.id, admin.email, 'TENANT_IMPERSONATED', 'tenant', id,
      { tenantSlug: slug }, getClientIp(req));

    return NextResponse.json({
      impersonateUrl: `${process.env.MAIN_APP_URL ?? 'http://localhost:3001'}/api/v1/auth/impersonate`,
      tenantSlug: slug,
      systemUserId,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[tenant impersonate]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
