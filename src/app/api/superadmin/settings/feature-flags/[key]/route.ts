import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const admin = requireAdmin(req);
    const { key } = await params;

    let body: { enabled?: boolean };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
    }

    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ message: 'enabled (boolean) required' }, { status: 400 });
    }

    const { rows: before } = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM feature_flags WHERE key = $1`,
      [key],
    );
    if (!before[0]) {
      return NextResponse.json({ message: 'Feature flag not found' }, { status: 404 });
    }

    const { rows } = await pool.query<{ key: string; enabled: boolean; description: string }>(
      `UPDATE feature_flags SET enabled = $1, updated_at = NOW() WHERE key = $2
       RETURNING key, enabled, description`,
      [body.enabled, key],
    );

    await logAudit(admin.id, admin.email, 'FEATURE_FLAG_CHANGED', 'settings', null, {
      key,
      from: before[0].enabled,
      to: body.enabled,
    }, getClientIp(req));

    const flag = rows[0];
    return NextResponse.json({
      key: flag.key,
      enabled: flag.enabled,
      description: flag.description ?? '',
      defaultEnabled: flag.enabled,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[feature-flag PATCH]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
