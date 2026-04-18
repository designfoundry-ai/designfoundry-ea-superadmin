import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await params;

    const { rows } = await pool.query<{
      id: string; license_id: string; tenant_id: string | null;
      customer_name: string; contact_email: string; delivery_model: string;
      plan: string; addons: unknown; features: unknown;
      max_users: number; max_objects: number;
      issued_at: string; expires_at: string | null;
      license_blob: string; key_id: string; status: string;
    }>(
      `SELECT id, license_id, tenant_id, customer_name, contact_email, delivery_model,
              plan, addons, features, max_users, max_objects,
              issued_at, expires_at, license_blob, key_id, status
       FROM licenses WHERE id = $1`,
      [id],
    );

    if (!rows[0]) return NextResponse.json({ message: 'License not found' }, { status: 404 });
    const r = rows[0];

    // Decode JWT payload for display (no verification needed here)
    let decoded: Record<string, unknown> = {};
    try {
      decoded = JSON.parse(Buffer.from(r.license_blob.split('.')[1], 'base64url').toString()) as Record<string, unknown>;
    } catch { /* ignore */ }

    return NextResponse.json({
      id: r.id,
      licenseId: r.license_id,
      tenantId: r.tenant_id,
      companyName: r.customer_name,
      contactEmail: r.contact_email,
      tier: r.plan,
      objectLimit: r.max_objects,
      userLimit: r.max_users,
      addOns: Array.isArray(r.addons) ? r.addons : [],
      features: Array.isArray(r.features) ? r.features : [],
      validFrom: r.issued_at,
      validUntil: r.expires_at ?? '',
      status: r.status,
      hardwareBinding: { enabled: false },
      isOnPrem: r.delivery_model === 'on_prem',
      deliveryModel: r.delivery_model,
      keyId: r.key_id,
      decodedPayload: decoded,
      objectCount: 0,
      userCount: 0,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[license GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
