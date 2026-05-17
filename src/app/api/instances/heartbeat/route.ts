// R1-16 §FR-4: instance liveness ping.
//
// Auth: X-Instance-Key header → SHA-256 hash → direct row lookup. Returns
// 401 when key is unknown/revoked (instance should re-register), 403 when
// the row is deactivated (instance should stop heartbeating).

import { NextRequest, NextResponse } from 'next/server';
import { hashApiKey } from '@/lib/instance-crypto';
import { recordHeartbeat } from '@/lib/services/instance-registration';
import { InstanceRegistryError } from '@/lib/services/instance-registry';

interface HeartbeatBody {
  version?: string | null;
  uptimeSec?: number | null;
}

export async function POST(req: NextRequest) {
  const headerKey = req.headers.get('x-instance-key');
  if (!headerKey) {
    return NextResponse.json(
      { error: 'missing X-Instance-Key' },
      { status: 401 },
    );
  }

  let body: HeartbeatBody = {};
  try {
    const raw = await req.text();
    if (raw.length > 0) {
      body = JSON.parse(raw) as HeartbeatBody;
    }
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await recordHeartbeat({
      apiKeyHash: hashApiKey(headerKey),
      version: body.version ?? null,
      uptimeSec: body.uptimeSec ?? null,
    });

    return NextResponse.json(
      {
        status: result.instance.status,
        heartbeatIntervalSec: result.heartbeatIntervalSec,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof InstanceRegistryError) {
      if (err.code === 'NO_KEY') {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: 401 },
        );
      }
      if (err.code === 'INVALID_STATE') {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: 403 },
        );
      }
    }
    console.error('[instances/heartbeat]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
