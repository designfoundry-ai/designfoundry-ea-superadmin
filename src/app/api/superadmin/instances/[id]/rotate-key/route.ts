import { NextRequest, NextResponse } from 'next/server';
import { AuthError, getClientIp, requireAdmin } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import {
  InstanceRegistryError,
  commitPendingKey,
  rotateKey,
} from '@/lib/services/instance-registry';

const KEY_WARNING =
  'This key will not be shown again. Configure it on the EA instance, then call test?pending=true to verify, then commit the rotation.';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;

    let action: 'generate' | 'commit' = 'generate';
    try {
      const body = (await req.json()) as { action?: string };
      if (body?.action === 'commit') action = 'commit';
    } catch {
      // empty body → default action
    }

    if (action === 'commit') {
      const updated = await commitPendingKey(id);
      await logAudit(
        admin.id,
        admin.email,
        'instance.key_rotated',
        'instance',
        id,
        { committedAt: updated.keyRotatedAt },
        getClientIp(req),
      );
      return NextResponse.json(updated);
    }

    const { instance, apiKey } = await rotateKey(id);
    await logAudit(
      admin.id,
      admin.email,
      'instance.key_rotation_started',
      'instance',
      id,
      null,
      getClientIp(req),
    );

    return NextResponse.json({
      id: instance.id,
      hasPendingKey: instance.hasPendingKey,
      apiKey,
      apiKeyWarning: KEY_WARNING,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof InstanceRegistryError) {
      const status =
        err.code === 'NOT_FOUND'
          ? 404
          : err.code === 'INVALID_STATE'
            ? 409
            : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('[instance rotate-key]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
