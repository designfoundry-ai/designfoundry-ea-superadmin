import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10)));
    const offset = (page - 1) * limit;
    const tenantId = sp.get('tenantId') ?? '';
    const eventType = sp.get('eventType') ?? '';
    const severity = sp.get('severity') ?? '';
    const from = sp.get('from') ?? '';
    const to = sp.get('to') ?? '';

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (tenantId) { conditions.push(`tenant_id = $${idx++}`); params.push(tenantId); }
    if (eventType) { conditions.push(`event_type = $${idx++}`); params.push(eventType); }
    if (severity) { conditions.push(`severity = $${idx++}`); params.push(severity); }
    if (from) { conditions.push(`created_at >= $${idx++}`); params.push(from); }
    if (to) { conditions.push(`created_at <= $${idx++}`); params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countResult, rows] = await Promise.all([
      pool.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM platform_activity_log ${where}`,
        params,
      ),
      pool.query<{
        id: string; tenant_id: string | null; tenant_slug: string | null;
        user_email: string | null; event_type: string; severity: string;
        details: Record<string, unknown> | null; created_at: string;
      }>(
        `SELECT id, tenant_id, tenant_slug, user_email, event_type, severity, details, created_at
         FROM platform_activity_log ${where}
         ORDER BY created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset],
      ),
    ]);

    const events = rows.rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      tenantName: r.tenant_slug,
      userId: undefined,
      userEmail: r.user_email,
      eventType: r.event_type,
      severity: r.severity,
      details: typeof r.details === 'string' ? r.details : JSON.stringify(r.details ?? {}),
      createdAt: r.created_at,
    }));

    return NextResponse.json({
      events,
      total: parseInt(countResult.rows[0].cnt, 10),
      page,
      limit,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[activity GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
