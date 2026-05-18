// Fan-out endpoint: ask every active instance for its tenant list, then
// aggregate. Used by the "Discover from instances" action on the
// superadmin tenants page so an operator can see the truth-on-the-wire
// (what each EA instance reports) alongside the central tenant registry.
//
// Per-instance failures (timeout, 401, unreachable) are reported in the
// response — they do not fail the whole call. Concurrency is limited to
// keep the superadmin from melting if 50 instances are registered.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, getClientIp, requireAdmin } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { listInstances } from '@/lib/services/instance-registry';
import {
  InstanceApiError,
  PlatformTenantSummary,
  getTenants as getInstanceTenants,
} from '@/lib/services/instance-api-client';

const MAX_CONCURRENCY = 5;

interface InstanceTenantResult {
  instanceId: string;
  instanceName: string;
  instanceUrl: string;
  environment: string;
  ok: boolean;
  tenantCount?: number;
  tenants?: PlatformTenantSummary[];
  latencyMs?: number;
  error?: { code: string; message: string; status?: number };
}

export async function POST(req: NextRequest) {
  try {
    const admin = requireAdmin(req);
    const all = await listInstances();
    const targets = all.filter((i) => i.status === 'active');

    const results = await runWithConcurrency<typeof targets[number], InstanceTenantResult>(
      targets,
      MAX_CONCURRENCY,
      async (instance) => {
        const start = Date.now();
        try {
          const list = await getInstanceTenants(instance.id);
          return {
            instanceId: instance.id,
            instanceName: instance.name,
            instanceUrl: instance.url,
            environment: instance.environment,
            ok: true,
            tenantCount: list.total ?? list.tenants.length,
            tenants: list.tenants,
            latencyMs: Date.now() - start,
          };
        } catch (err: unknown) {
          const base = {
            instanceId: instance.id,
            instanceName: instance.name,
            instanceUrl: instance.url,
            environment: instance.environment,
            ok: false,
            latencyMs: Date.now() - start,
          };
          if (err instanceof InstanceApiError) {
            return {
              ...base,
              error: { code: err.code, message: err.message, status: err.status },
            };
          }
          return {
            ...base,
            error: {
              code: 'INTERNAL',
              message: err instanceof Error ? err.message : 'unknown error',
            },
          };
        }
      },
    );

    const totalTenants = results.reduce(
      (sum, r) => sum + (r.tenantCount ?? 0),
      0,
    );
    const okCount = results.filter((r) => r.ok).length;

    await logAudit(
      admin.id,
      admin.email,
      'tenants.discover_from_instances',
      'instance',
      null,
      {
        instancesQueried: targets.length,
        instancesOk: okCount,
        instancesFailed: targets.length - okCount,
        tenantsFound: totalTenants,
      },
      getClientIp(req),
    );

    return NextResponse.json({
      scannedAt: new Date().toISOString(),
      totals: {
        instances: targets.length,
        ok: okCount,
        failed: targets.length - okCount,
        tenants: totalTenants,
      },
      results,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[instances/tenants discover]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function pump(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => pump()),
  );
  return results;
}
