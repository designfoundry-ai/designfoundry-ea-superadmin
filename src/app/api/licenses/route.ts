import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { signLicense, planDefaults } from '@/lib/license';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '50', 10)));
    const offset = (page - 1) * limit;
    const status = sp.get('status') ?? '';
    const deliveryModel = sp.get('deliveryModel') ?? '';

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
    if (deliveryModel) { conditions.push(`delivery_model = $${idx++}`); params.push(deliveryModel); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countResult, rows] = await Promise.all([
      pool.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM licenses ${where}`,
        params,
      ),
      pool.query<{
        id: string; license_id: string; tenant_id: string | null;
        customer_name: string; contact_email: string; delivery_model: string;
        plan: string; addons: string[]; features: string[];
        max_users: number; max_objects: number;
        issued_at: string; expires_at: string | null;
        key_id: string; status: string; created_at: string;
      }>(
        `SELECT id, license_id, tenant_id, customer_name, contact_email, delivery_model,
                plan, addons, features, max_users, max_objects,
                issued_at, expires_at, key_id, status, created_at
         FROM licenses ${where}
         ORDER BY created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset],
      ),
    ]);

    const licenses = rows.rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id ?? '',
      companyName: r.customer_name,
      contactEmail: r.contact_email,
      tier: r.plan as 'free' | 'team' | 'professional' | 'enterprise',
      objectLimit: r.max_objects,
      objectCount: 0,
      userLimit: r.max_users,
      userCount: 0,
      addOns: Array.isArray(r.addons) ? r.addons : [],
      validFrom: r.issued_at,
      validUntil: r.expires_at ?? '',
      status: r.status as 'active' | 'expiring' | 'expired' | 'revoked',
      hardwareBinding: { enabled: false },
      isOnPrem: r.delivery_model === 'on_prem',
      deliveryModel: r.delivery_model,
      keyId: r.key_id,
    }));

    return NextResponse.json({ licenses, total: parseInt(countResult.rows[0].cnt, 10) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[licenses GET]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = requireAdmin(req);

    const body = await req.json() as {
      customerName: string;
      contactEmail: string;
      tenantSlug?: string;
      plan: string;
      maxUsers?: number;
      maxObjects?: number;
      features?: string[];
      addons?: string[];
      expiresAt?: string;
      deliveryModel?: 'saas' | 'on_prem' | 'dev';
    };

    if (!body.customerName || !body.contactEmail || !body.plan) {
      return NextResponse.json({ message: 'customerName, contactEmail, plan required' }, { status: 400 });
    }

    const defaults = planDefaults(body.plan);
    const maxUsers = body.maxUsers ?? defaults.maxUsers;
    const maxObjects = body.maxObjects ?? defaults.maxObjects;
    const features = body.features ?? defaults.features;
    const addons = body.addons ?? [];
    const deliveryModel = body.deliveryModel ?? 'on_prem';
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;

    // Resolve tenant_id from slug
    let tenantId: string | null = null;
    if (body.tenantSlug) {
      const r = await pool.query<{ id: string }>(
        `SELECT id FROM tenants WHERE slug = $1`,
        [body.tenantSlug],
      );
      tenantId = r.rows[0]?.id ?? null;
    }

    const licenseJwt = signLicense({
      customerId: tenantId ?? body.customerName.toLowerCase().replace(/\s+/g, '-'),
      customerName: body.customerName,
      plan: body.plan,
      maxUsers,
      maxObjects,
      features,
      addons,
      deliveryModel,
    }, expiresAt);

    // Extract jti from JWT (second base64 segment)
    const payload = JSON.parse(Buffer.from(licenseJwt.split('.')[1], 'base64url').toString()) as { jti: string };

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO licenses
         (license_id, tenant_id, customer_name, contact_email, delivery_model,
          plan, addons, features, max_users, max_objects, issued_at, expires_at,
          license_blob, key_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, NOW(), $11, $12, $13, 'active')
       RETURNING id`,
      [
        payload.jti, tenantId, body.customerName, body.contactEmail, deliveryModel,
        body.plan,
        JSON.stringify(addons), JSON.stringify(features),
        maxUsers, maxObjects,
        expiresAt ?? null,
        licenseJwt,
        process.env.LICENSE_KEY_ID ?? 'dev-2026-01',
      ],
    );

    // For SaaS tenants: write license_blob to tenants table
    if (tenantId) {
      await pool.query(
        `UPDATE tenants SET license_blob = $1, license_updated = NOW() WHERE id = $2`,
        [licenseJwt, tenantId],
      );
    }

    await logAudit(admin.id, admin.email, 'LICENSE_GENERATED', 'license', rows[0].id,
      { customerName: body.customerName, plan: body.plan }, getClientIp(req));

    return NextResponse.json({ id: rows[0].id, licenseJwt }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    console.error('[licenses POST]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
