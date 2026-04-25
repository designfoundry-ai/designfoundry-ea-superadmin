import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

async function getTenantRow(id: string) {
  const { rows } = await pool.query<{
    id: string; name: string; slug: string; plan: string; status: string;
    is_active: boolean; created_at: string; license_blob: string | null;
  }>(
    `SELECT id, name, slug, plan, status, is_active, created_at, license_blob
     FROM tenants WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await params;

    const t = await getTenantRow(id);
    if (!t) return NextResponse.json({ message: 'Tenant not found' }, { status: 404 });

    let usersCount = 0, objectsCount = 0, diagramsCount = 0, primaryEmail = '';

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

    return NextResponse.json({
      id: t.id, name: t.name, slug: t.slug, plan: t.plan, status: t.status,
      mrr: 0, usersCount, objectsCount, diagramsCount, storageUsedMb: 0,
      primaryEmail, createdAt: t.created_at, lastActiveAt: t.created_at,
      licenseBlob: t.license_blob,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[tenant GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;
    const body = await req.json() as { name?: string; plan?: string; status?: string };

    const t = await getTenantRow(id);
    if (!t) return NextResponse.json({ message: 'Tenant not found' }, { status: 404 });

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.name !== undefined) { updates.push(`name = $${idx++}`); values.push(body.name); }
    if (body.plan !== undefined) { updates.push(`plan = $${idx++}`); values.push(body.plan); }
    if (body.status !== undefined) { updates.push(`status = $${idx++}`); values.push(body.status); }

    if (updates.length > 0) {
      values.push(id);
      await pool.query(`UPDATE tenants SET ${updates.join(', ')} WHERE id = $${idx}`, values);
      await logAudit(admin.id, admin.email, 'TENANT_UPDATED', 'tenant', id,
        { changes: body }, getClientIp(req));
    }

    const updated = await getTenantRow(id);
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[tenant PATCH]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;

    const t = await getTenantRow(id);
    if (!t) return NextResponse.json({ message: 'Tenant not found' }, { status: 404 });

    // Drop tenant schema, then delete tenant record
    await pool.query(`DROP SCHEMA IF EXISTS "t_${t.slug}" CASCADE`);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [id]);

    await logAudit(admin.id, admin.email, 'TENANT_DELETED', 'tenant', id,
      { name: t.name, slug: t.slug }, getClientIp(req));

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[tenant DELETE]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
