import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);

    // Basic counts from public schema
    const tenantRows = await pool.query<{
      total: string;
      active: string;
      trial: string;
      suspended: string;
      cancelled: string;
    }>(`
      SELECT
        COUNT(*)                                             AS total,
        COUNT(*) FILTER (WHERE status = 'active')           AS active,
        COUNT(*) FILTER (WHERE status = 'trial')            AS trial,
        COUNT(*) FILTER (WHERE status = 'suspended')        AS suspended,
        COUNT(*) FILTER (WHERE status = 'cancelled' OR status = 'canceled') AS cancelled
      FROM tenants
    `);

    const tc = tenantRows.rows[0];

    // Signups per week (last 12 weeks)
    const signupRows = await pool.query<{ week: string; count: string }>(`
      SELECT
        to_char(date_trunc('week', created_at), 'Mon DD') AS week,
        COUNT(*)                                           AS count
      FROM tenants
      WHERE created_at >= NOW() - INTERVAL '12 weeks'
      GROUP BY date_trunc('week', created_at)
      ORDER BY date_trunc('week', created_at)
    `);

    // Signups per month for MRR history placeholders
    const monthRows = await pool.query<{ month: string; count: string }>(`
      SELECT
        to_char(date_trunc('month', created_at), 'Mon YYYY') AS month,
        COUNT(*) AS count
      FROM tenants
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('month', created_at)
      ORDER BY date_trunc('month', created_at)
    `);

    // Cross-tenant user count (sum across all tenant schemas)
    const tenantSlugs = await pool.query<{ slug: string }>(
      `SELECT slug FROM tenants WHERE is_active = true ORDER BY created_at DESC LIMIT 100`,
    );

    let totalUsers = 0;
    const topByUsage: Array<{ tenantId: string; name: string; objects: number; diagrams: number }> = [];

    // Fetch tenant details for top usage
    const tenantDetails = await pool.query<{ id: string; name: string; slug: string }>(
      `SELECT id, name, slug FROM tenants WHERE is_active = true ORDER BY created_at DESC LIMIT 20`,
    );

    await Promise.allSettled(
      tenantSlugs.rows.map(async ({ slug }) => {
        try {
          const r = await pool.query<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM "t_${slug}".users WHERE is_system_account = false`,
          );
          totalUsers += parseInt(r.rows[0]?.cnt ?? '0', 10);
        } catch { /* schema may not exist yet */ }
      }),
    );

    await Promise.allSettled(
      tenantDetails.rows.map(async (t) => {
        try {
          const [objR, diagR] = await Promise.all([
            pool.query<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM "t_${t.slug}".architecture_objects`),
            pool.query<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM "t_${t.slug}".diagrams`),
          ]);
          topByUsage.push({
            tenantId: t.id,
            name: t.name,
            objects: parseInt(objR.rows[0]?.cnt ?? '0', 10),
            diagrams: parseInt(diagR.rows[0]?.cnt ?? '0', 10),
          });
        } catch { /* schema may not exist */ }
      }),
    );

    topByUsage.sort((a, b) => (b.objects + b.diagrams) - (a.objects + a.diagrams));

    const stats = {
      totalTenants: parseInt(tc.total, 10),
      activeMRR: 0,
      arr: 0,
      totalUsers,
      churnRate: 0,
      trialTenants: parseInt(tc.trial, 10),
      mrrHistory: monthRows.rows.map(r => ({ month: r.month, mrr: 0 })),
      signupsHistory: signupRows.rows.map(r => ({ week: r.week, count: parseInt(r.count, 10) })),
      tenantStatusBreakdown: {
        active: parseInt(tc.active, 10),
        trial: parseInt(tc.trial, 10),
        pastDue: 0,
        canceled: parseInt(tc.cancelled, 10),
      },
      topTenantsByUsage: topByUsage.slice(0, 10),
      churnHistory: monthRows.rows.map(r => ({ month: r.month, rate: 0 })),
    };

    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    console.error('[stats]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
