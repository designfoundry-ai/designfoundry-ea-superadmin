import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { reason?: string };

    const { rows } = await pool.query<{ license_id: string; customer_name: string }>(
      `SELECT license_id, customer_name FROM licenses WHERE id = $1`,
      [id],
    );
    if (!rows[0]) return NextResponse.json({ message: 'License not found' }, { status: 404 });

    await pool.query(`UPDATE licenses SET status = 'revoked', updated_at = NOW() WHERE id = $1`, [id]);

    await pool.query(
      `INSERT INTO revoked_licenses (license_id, reason, revoked_by) VALUES ($1, $2, $3)
       ON CONFLICT (license_id) DO NOTHING`,
      [rows[0].license_id, body.reason ?? null, admin.id],
    );

    await logAudit(admin.id, admin.email, 'LICENSE_REVOKED', 'license', id,
      { customerName: rows[0].customer_name, reason: body.reason }, getClientIp(req));

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[license revoke]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
