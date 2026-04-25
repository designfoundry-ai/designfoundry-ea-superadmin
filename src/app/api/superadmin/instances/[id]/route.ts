import { NextRequest, NextResponse } from 'next/server';
import { AuthError, getClientIp, requireAdmin } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import {
  InstanceRegistryError,
  deactivateInstance,
  getInstance,
} from '@/lib/services/instance-registry';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireAdmin(req);
    const { id } = await params;
    const instance = await getInstance(id);
    return NextResponse.json(instance);
  } catch (err) {
    return handleError(err, 'instance GET');
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = requireAdmin(req);
    const { id } = await params;
    const before = await getInstance(id);
    await deactivateInstance(id);

    await logAudit(
      admin.id,
      admin.email,
      'instance.deactivated',
      'instance',
      id,
      { name: before.name, url: before.url },
      getClientIp(req),
    );

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleError(err, 'instance DELETE');
  }
}

function handleError(err: unknown, label: string): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (err instanceof InstanceRegistryError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'INVALID_INPUT'
          ? 400
          : 422;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error(`[${label}]`, err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
