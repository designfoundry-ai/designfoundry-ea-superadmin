import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '50', 10)));
    const search = sp.get('search') ?? '';

    const tenants = await pool.query<{ id: string; name: string; slug: string }>(
      `SELECT id, name, slug FROM tenants WHERE is_active = true ORDER BY name`,
    );

    const allUsers: Array<{
      id: string; name: string; email: string; tenantId: string; tenantName: string;
      role: string; status: string; createdAt: string; lastLoginAt?: string;
    }> = [];

    await Promise.allSettled(
      tenants.rows.map(async (t) => {
        try {
          const rows = await pool.query<{
            id: string; email: string; first_name: string; last_name: string;
            roles: string; is_active: boolean; created_at: string;
          }>(
            `SELECT id, email, first_name, last_name, roles, is_active, created_at
             FROM "t_${t.slug}".users
             WHERE is_system_account = false`,
          );
          for (const u of rows.rows) {
            allUsers.push({
              id: u.id,
              name: `${u.first_name} ${u.last_name}`.trim(),
              email: u.email,
              tenantId: t.id,
              tenantName: t.name,
              role: u.roles,
              status: u.is_active ? 'active' : 'disabled',
              createdAt: u.created_at,
            });
          }
        } catch { /* schema not ready */ }
      }),
    );

    const filtered = search
      ? allUsers.filter(u =>
          u.name.toLowerCase().includes(search.toLowerCase()) ||
          u.email.toLowerCase().includes(search.toLowerCase()),
        )
      : allUsers;

    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const paginated = filtered.slice((page - 1) * limit, page * limit);

    return NextResponse.json({ users: paginated, total: filtered.length, page, limit });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[users GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
