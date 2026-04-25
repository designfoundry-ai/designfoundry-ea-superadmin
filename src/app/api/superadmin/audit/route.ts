import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '50', 10)));
    const offset = (page - 1) * limit;
    const action = sp.get('action') ?? '';
    const from = sp.get('from') ?? '';
    const to = sp.get('to') ?? '';

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (action) { conditions.push(`action ILIKE $${idx++}`); params.push(`%${action}%`); }
    if (from) { conditions.push(`created_at >= $${idx++}`); params.push(from); }
    if (to) { conditions.push(`created_at <= $${idx++}`); params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countResult, rows] = await Promise.all([
      pool.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM admin_audit_log ${where}`,
        params,
      ),
      pool.query<{
        id: string; admin_user_id: string; admin_email: string | null;
        action: string; target_type: string | null; target_id: string | null;
        details: Record<string, unknown> | null; ip_address: string | null; created_at: string;
      }>(
        `SELECT id, admin_user_id, admin_email, action, target_type, target_id,
                details, ip_address, created_at
         FROM admin_audit_log ${where}
         ORDER BY created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset],
      ),
    ]);

    const entries = rows.rows.map(r => ({
      id: r.id,
      adminUserId: r.admin_user_id,
      adminEmail: r.admin_email ?? '',
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      details: r.details ? JSON.stringify(r.details) : '',
      ipAddress: r.ip_address ?? '',
      createdAt: r.created_at,
    }));

    return NextResponse.json({
      entries,
      total: parseInt(countResult.rows[0].cnt, 10),
      page,
      limit,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[audit GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
