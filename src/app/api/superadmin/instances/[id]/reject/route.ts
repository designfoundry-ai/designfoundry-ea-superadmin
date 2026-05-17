// R1-16 §FR-5: operator rejects a self-registered instance.
// Hard-revokes the key and marks the row deactivated.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, getClientIp, requireAdmin } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { rejectInstance } from '@/lib/services/instance-registration';
import { InstanceRegistryError } from '@/lib/services/instance-registry';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;
    const instance = await rejectInstance(id);

    await logAudit(
      admin.id,
      admin.email,
      'instance.rejected',
      'instance',
      id,
      { name: instance.name, url: instance.url, environment: instance.environment },
      getClientIp(req),
    );

    return NextResponse.json(instance);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof InstanceRegistryError) {
      const status = err.code === 'INVALID_STATE' ? 409 : 422;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status },
      );
    }
    console.error('[instances/:id/reject]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
