import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;

    const { rows } = await pool.query<{ name: string }>(
      `UPDATE tenants SET status = 'suspended', is_active = false WHERE id = $1
       RETURNING name`,
      [id],
    );

    if (!rows[0]) return NextResponse.json({ message: 'Tenant not found' }, { status: 404 });

    await logAudit(admin.id, admin.email, 'TENANT_SUSPENDED', 'tenant', id,
      { name: rows[0].name }, getClientIp(req));

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[tenant suspend]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
