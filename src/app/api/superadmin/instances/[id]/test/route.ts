import { NextRequest, NextResponse } from 'next/server';
import { AuthError, getClientIp, requireAdmin } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import {
  InstanceRegistryError,
  recordHealthCheck,
} from '@/lib/services/instance-registry';
import {
  InstanceApiError,
  getHealth,
} from '@/lib/services/instance-api-client';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;
    const url = new URL(req.url);
    const usePending = url.searchParams.get('pending') === 'true';

    try {
      const { data, latencyMs } = await getHealth(id, { pending: usePending });
      const updated = await recordHealthCheck(id, {
        ok: true,
        instanceVersion: data.version ?? null,
      });

      await logAudit(
        admin.id,
        admin.email,
        'instance.tested',
        'instance',
        id,
        { ok: true, latencyMs, pending: usePending },
        getClientIp(req),
      );

      return NextResponse.json({
        ok: true,
        status: updated.status,
        lastHealthCheck: updated.lastHealthCheck,
        instanceVersion: updated.instanceVersion,
        latencyMs,
      });
    } catch (err) {
      if (err instanceof InstanceApiError) {
        await recordHealthCheck(id, { ok: false }).catch(() => {});
        await logAudit(
          admin.id,
          admin.email,
          'instance.test_failed',
          'instance',
          id,
          { code: err.code, status: err.status, message: err.message },
          getClientIp(req),
        );
        return NextResponse.json(
          { ok: false, code: err.code, error: err.message },
          { status: 502 },
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof InstanceRegistryError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === 'NOT_FOUND' ? 404 : 422 },
      );
    }
    console.error('[instance test]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
