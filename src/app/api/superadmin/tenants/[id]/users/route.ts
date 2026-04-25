import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await params;

    const tenantRow = await pool.query<{ slug: string }>(
      `SELECT slug FROM tenants WHERE id = $1`,
      [id],
    );
    if (!tenantRow.rows[0]) {
      return NextResponse.json({ message: 'Tenant not found' }, { status: 404 });
    }
    const { slug } = tenantRow.rows[0];

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '50', 10)));
    const offset = (page - 1) * limit;

    const result = await pool.query<{
      id: string; email: string; first_name: string; last_name: string;
      roles: string; is_active: boolean; created_at: string; updated_at: string;
    }>(
      `SELECT id, email, first_name, last_name, roles, is_active, created_at, updated_at
       FROM "t_${slug}".users
       WHERE is_system_account = false
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const countResult = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM "t_${slug}".users WHERE is_system_account = false`,
    );

    const users = result.rows.map(u => ({
      id: u.id,
      name: `${u.first_name} ${u.last_name}`.trim(),
      email: u.email,
      tenantId: id,
      tenantName: slug,
      role: u.roles,
      status: u.is_active ? 'active' : 'disabled',
      createdAt: u.created_at,
      lastLoginAt: undefined,
    }));

    return NextResponse.json({
      users,
      total: parseInt(countResult.rows[0].cnt, 10),
      page,
      limit,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[tenant users GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
