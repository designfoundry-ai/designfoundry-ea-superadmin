import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

const SLUG_RE = /^[a-z0-9_]+$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;

    let body: { tenantId?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body.tenantId) {
      return NextResponse.json({ message: 'tenantId required' }, { status: 400 });
    }

    const tenantRow = await pool.query<{ slug: string }>(
      `SELECT slug FROM tenants WHERE id = $1`,
      [body.tenantId],
    );
    if (!tenantRow.rows[0]) {
      return NextResponse.json({ message: 'Tenant not found' }, { status: 404 });
    }
    const { slug } = tenantRow.rows[0];
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json({ message: 'Invalid tenant slug' }, { status: 400 });
    }

    const result = await pool.query<{ email: string }>(
      `UPDATE "t_${slug}".users SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND is_system_account = false
       RETURNING email`,
      [id],
    );
    if (!result.rows[0]) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }

    await logAudit(admin.id, admin.email, 'USER_DISABLED', 'user', id,
      { tenantId: body.tenantId, email: result.rows[0].email }, getClientIp(req));

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[user disable]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
