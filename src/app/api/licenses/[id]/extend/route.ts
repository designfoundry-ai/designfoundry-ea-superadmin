import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { signLicense } from '@/lib/license';
import { logAudit } from '@/lib/audit';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;
    const { months = 12 } = await req.json() as { months?: number };

    const { rows } = await pool.query<{
      id: string; license_id: string; tenant_id: string | null;
      customer_name: string; contact_email: string; delivery_model: string;
      plan: string; addons: string[]; features: string[];
      max_users: number; max_objects: number; expires_at: string | null;
    }>(
      `SELECT id, license_id, tenant_id, customer_name, contact_email, delivery_model,
              plan, addons, features, max_users, max_objects, expires_at
       FROM licenses WHERE id = $1`,
      [id],
    );
    if (!rows[0]) return NextResponse.json({ message: 'License not found' }, { status: 404 });
    const r = rows[0];

    const base = r.expires_at ? new Date(r.expires_at) : new Date();
    if (base < new Date()) base.setTime(new Date().getTime());
    const newExpiry = new Date(base);
    newExpiry.setMonth(newExpiry.getMonth() + months);

    const newJwt = signLicense({
      customerId: r.tenant_id ?? r.customer_name.toLowerCase().replace(/\s+/g, '-'),
      customerName: r.customer_name,
      plan: r.plan,
      maxUsers: r.max_users,
      maxObjects: r.max_objects,
      features: Array.isArray(r.features) ? r.features : [],
      addons: Array.isArray(r.addons) ? r.addons : [],
      deliveryModel: r.delivery_model as 'saas' | 'on_prem' | 'dev',
    }, newExpiry);

    const newPayload = JSON.parse(Buffer.from(newJwt.split('.')[1], 'base64url').toString()) as { jti: string };

    await pool.query(
      `UPDATE licenses
       SET license_id = $1, license_blob = $2, expires_at = $3, status = 'active', updated_at = NOW()
       WHERE id = $4`,
      [newPayload.jti, newJwt, newExpiry, id],
    );

    // Update revoked_licenses to remove old entry if re-activating
    await pool.query(`DELETE FROM revoked_licenses WHERE license_id = $1`, [r.license_id]);

    if (r.tenant_id) {
      await pool.query(
        `UPDATE tenants SET license_blob = $1, license_updated = NOW() WHERE id = $2`,
        [newJwt, r.tenant_id],
      );
    }

    await logAudit(admin.id, admin.email, 'LICENSE_EXTENDED', 'license', id,
      { months, newExpiry: newExpiry.toISOString() }, getClientIp(req));

    return NextResponse.json({ success: true, newExpiry: newExpiry.toISOString() });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[license extend]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
