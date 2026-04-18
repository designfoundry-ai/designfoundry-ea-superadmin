import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);

    const rows = await pool.query<{ key: string; enabled: boolean; description: string }>(
      `SELECT key, enabled, description FROM feature_flags ORDER BY key`,
    );

    const flags = rows.rows.map(r => ({
      key: r.key,
      description: r.description ?? '',
      enabled: r.enabled,
      defaultEnabled: r.enabled,
    }));

    return NextResponse.json(flags);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[feature-flags GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = requireAdmin(req);
    const body = await req.json() as { key: string; enabled: boolean };

    const { rows: before } = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM feature_flags WHERE key = $1`,
      [body.key],
    );

    await pool.query(
      `UPDATE feature_flags SET enabled = $1, updated_at = NOW() WHERE key = $2`,
      [body.enabled, body.key],
    );

    await logAudit(admin.id, admin.email, 'FEATURE_FLAG_CHANGED', 'settings', null, {
      key: body.key,
      from: before[0]?.enabled,
      to: body.enabled,
    }, getClientIp(req));

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[feature-flags PATCH]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
