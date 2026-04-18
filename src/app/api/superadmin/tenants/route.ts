import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '25', 10)));
    const offset = (page - 1) * limit;
    const search = sp.get('search') ?? '';
    const plan = sp.get('plan') ?? '';
    const status = sp.get('status') ?? '';

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`(t.name ILIKE $${idx} OR t.slug ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (plan) { conditions.push(`t.plan = $${idx++}`); params.push(plan); }
    if (status) { conditions.push(`t.status = $${idx++}`); params.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM tenants t ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0].cnt, 10);

    const rows = await pool.query<{
      id: string; name: string; slug: string; plan: string; status: string;
      is_active: boolean; created_at: string;
    }>(
      `SELECT t.id, t.name, t.slug, t.plan, t.status, t.is_active, t.created_at
       FROM tenants t ${where}
       ORDER BY t.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    );

    // Enrich each tenant with user count and admin email
    const tenants = await Promise.all(
      rows.rows.map(async (t) => {
        let usersCount = 0;
        let primaryEmail = '';
        let objectsCount = 0;
        let diagramsCount = 0;

        await Promise.allSettled([
          pool.query<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM "t_${t.slug}".users WHERE is_system_account = false`,
          ).then(r => { usersCount = parseInt(r.rows[0]?.cnt ?? '0', 10); }),

          pool.query<{ email: string }>(
            `SELECT email FROM "t_${t.slug}".users WHERE roles = 'admin' AND is_system_account = false LIMIT 1`,
          ).then(r => { primaryEmail = r.rows[0]?.email ?? ''; }),

          pool.query<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM "t_${t.slug}".architecture_objects`,
          ).then(r => { objectsCount = parseInt(r.rows[0]?.cnt ?? '0', 10); }),

          pool.query<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM "t_${t.slug}".diagrams`,
          ).then(r => { diagramsCount = parseInt(r.rows[0]?.cnt ?? '0', 10); }),
        ]);

        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          plan: t.plan,
          status: t.status,
          mrr: 0,
          usersCount,
          objectsCount,
          diagramsCount,
          storageUsedMb: 0,
          primaryEmail,
          createdAt: t.created_at,
          lastActiveAt: t.created_at,
        };
      }),
    );

    return NextResponse.json({ tenants, total, page, limit });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[tenants GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
