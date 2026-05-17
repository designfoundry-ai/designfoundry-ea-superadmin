// R1-16 §FR-3: instance-initiated self-registration endpoint.
//
// Unauthenticated by JWT — the bootstrap token in the request body is the
// auth surface. Per-IP rate limiting applied before any DB work to keep
// brute-force attempts cheap to reject.

import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  RegisterInput,
  registerOrUpsert,
} from '@/lib/services/instance-registration';
import { InstanceRegistryError } from '@/lib/services/instance-registry';

const KEY_WARNING =
  'This key will not be shown again. The instance stores it locally — operators should never need to copy it manually.';

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit({ key: `register:${ip}` });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate limit exceeded' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      },
    );
  }

  let body: Partial<RegisterInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const input: RegisterInput = {
    instanceId: (body.instanceId ?? '').toString(),
    name: (body.name ?? '').toString(),
    url: (body.url ?? '').toString(),
    environment: (body.environment ?? 'production') as RegisterInput['environment'],
    version: body.version ? String(body.version) : null,
    registrationToken: (body.registrationToken ?? '').toString(),
  };

  try {
    const result = await registerOrUpsert(input);

    if (result.isNew) {
      await logAudit(
        result.instance.id,
        `instance:${result.instance.name}`,
        'instance.self_registered',
        'instance',
        result.instance.id,
        {
          name: result.instance.name,
          url: result.instance.url,
          environment: result.instance.environment,
          status: result.instance.status,
        },
        ip,
      );
    }

    return NextResponse.json(
      {
        instanceId: result.instance.id,
        status: result.instance.status,
        heartbeatIntervalSec: result.heartbeatIntervalSec,
        ...(result.apiKey
          ? { apiKey: result.apiKey, apiKeyWarning: KEY_WARNING }
          : {}),
      },
      { status: result.isNew ? 201 : 200 },
    );
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown): NextResponse {
  if (err instanceof InstanceRegistryError) {
    let status = 422;
    switch (err.code) {
      case 'INVALID_INPUT':
        status = 400;
        break;
      case 'NO_KEY':
        status = 401;
        break;
      case 'INVALID_STATE':
        status = err.message.includes('disabled')
          ? 403
          : err.message.includes('different URL') ||
              err.message.includes('deactivated')
            ? 409
            : 500;
        break;
      case 'DUPLICATE_URL':
        status = 409;
        break;
    }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status },
    );
  }
  console.error('[instances/register]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
