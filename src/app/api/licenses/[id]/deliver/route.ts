import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireAdmin, AuthError, getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { EventBusService, EventBusError } from '@/lib/event-bus';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { instanceId?: string };

    if (!body.instanceId) {
      return NextResponse.json(
        { message: 'instanceId is required' },
        { status: 400 },
      );
    }

    const { rows } = await pool.query<{
      license_id: string;
      tenant_id: string | null;
      delivery_model: string;
      plan: string;
      features: unknown;
      max_users: number;
      max_objects: number;
      expires_at: string | null;
      license_blob: string;
      status: string;
    }>(
      `SELECT license_id, tenant_id, delivery_model, plan, features,
              max_users, max_objects, expires_at, license_blob, status
       FROM licenses WHERE id = $1`,
      [id],
    );

    if (!rows[0]) {
      return NextResponse.json({ message: 'License not found' }, { status: 404 });
    }
    const r = rows[0];

    if (r.delivery_model !== 'saas') {
      return NextResponse.json(
        { message: 'Only saas licenses can be delivered via event bus' },
        { status: 400 },
      );
    }
    if (r.status === 'revoked') {
      return NextResponse.json(
        { message: 'Cannot deliver a revoked license' },
        { status: 400 },
      );
    }

    try {
      const result = await EventBusService.deliverLicense({
        instanceId: body.instanceId,
        tenantId: r.tenant_id,
        actor: { userId: admin.id, email: admin.email },
        payload: {
          licenseId: r.license_id,
          licenseBlob: r.license_blob,
          plan: r.plan,
          features: Array.isArray(r.features) ? (r.features as string[]) : [],
          maxUsers: r.max_users,
          maxObjects: r.max_objects,
          expiresAt: r.expires_at,
        },
      });

      await logAudit(
        admin.id,
        admin.email,
        'LICENSE_REDELIVERED',
        'license',
        id,
        { instanceId: body.instanceId, envelopeId: result.envelopeId, mode: result.mode },
        getClientIp(req),
      );

      return NextResponse.json({
        ok: true,
        envelopeId: result.envelopeId,
        mode: result.mode,
      });
    } catch (err) {
      if (err instanceof EventBusError) {
        const status = err.code === 'INSTANCE_INACTIVE' ? 409
          : err.code === 'CONFIG' || err.code === 'NO_SECRET' ? 503
          : 502;
        console.error('[license deliver]', err);
        return NextResponse.json(
          { message: err.message, code: err.code },
          { status },
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    console.error('[license deliver]', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
