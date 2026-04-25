import { NextRequest, NextResponse } from 'next/server';
import { AuthError, getClientIp, requireAdmin } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import {
  CreateInstanceInput,
  InstanceRegistryError,
  createInstance,
  listInstances,
} from '@/lib/services/instance-registry';

const KEY_WARNING =
  'This key will not be shown again. Store it securely and configure it on the EA instance as PLATFORM_ADMIN_API_KEY.';

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const instances = await listInstances();
    return NextResponse.json({ instances, total: instances.length });
  } catch (err) {
    return handleError(err, 'instances GET');
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = requireAdmin(req);

    let body: Partial<CreateInstanceInput>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    const input: CreateInstanceInput = {
      name: (body.name ?? '').toString(),
      url: (body.url ?? '').toString(),
      environment: (body.environment ?? 'production') as CreateInstanceInput['environment'],
    };

    const instance = await createInstance(input);

    await logAudit(
      admin.id,
      admin.email,
      'instance.created',
      'instance',
      instance.id,
      { name: instance.name, url: instance.url, environment: instance.environment },
      getClientIp(req),
    );

    const { apiKey, ...rest } = instance;
    return NextResponse.json(
      { ...rest, apiKey, apiKeyWarning: KEY_WARNING },
      { status: 201 },
    );
  } catch (err) {
    return handleError(err, 'instances POST');
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
        : err.code === 'DUPLICATE_URL'
          ? 409
          : err.code === 'INVALID_INPUT'
            ? 400
            : 422;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error(`[${label}]`, err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
