// Manual full sync: fans out to every active instance, calls
// /api/v1/platform/tenants on each, and UPSERTs into tenants_cache.
// Per-instance failures (timeout, 401, unreachable) are reported in the
// response without failing the whole sync. Tenants no longer returned
// by an instance are tombstoned (deleted_at set).
//
// Triggered by the "Sync now" button on /superadmin/tenants and the
// post-approval one-shot when an operator approves a new instance.

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, getClientIp, requireAdmin } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { listInstances } from '@/lib/services/instance-registry';
import {
  InstanceApiError,
  getTenants as getInstanceTenants,
} from '@/lib/services/instance-api-client';
import {
  markMissingAsDeleted,
  upsertTenant,
} from '@/lib/services/tenants-cache';

const MAX_CONCURRENCY = 5;
const STALE_HEARTBEAT_MS = 10 * 60 * 1000; // 10 minutes — skip instances we think are dead

interface SyncInstanceResult {
  instanceId: string;
  instanceName: string;
  environment: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  upserted?: number;
  tombstoned?: number;
  latencyMs?: number;
  error?: { code: string; message: string; status?: number };
}

export async function POST(req: NextRequest) {
  try {
    const admin = requireAdmin(req);

    // Optional ?instanceId=... narrows the sync to a single instance.
    // Used by the post-approval one-shot.
    const url = new URL(req.url);
    const onlyInstance = url.searchParams.get('instanceId');

    const all = await listInstances();
    let targets = all.filter((i) => i.status === 'active');
    if (onlyInstance) {
      targets = targets.filter((i) => i.id === onlyInstance);
    }

    const scannedAt = new Date();
    const results = await runWithConcurrency<typeof targets[number], SyncInstanceResult>(
      targets,
      MAX_CONCURRENCY,
      async (instance) => {
        const base = {
          instanceId: instance.id,
          instanceName: instance.name,
          environment: instance.environment,
        };

        // Skip instances we believe are dead — avoid the 5s timeout per
        // instance just to discover they're unreachable. Heartbeat
        // freshness is the cheap signal we already have.
        const lastHb = instance.lastHealthCheck
          ? new Date(instance.lastHealthCheck).getTime()
          : null;
        if (lastHb !== null && Date.now() - lastHb > STALE_HEARTBEAT_MS) {
          return {
            ...base,
            ok: false,
            skipped: true,
            reason: `stale heartbeat (last seen ${Math.round((Date.now() - lastHb) / 60000)} min ago)`,
          };
        }

        const start = Date.now();
        try {
          const list = await getInstanceTenants(instance.id);
          let upserted = 0;
          for (const t of list.tenants) {
            await upsertTenant({
              instanceId: instance.id,
              tenantId: t.id,
              name: t.name,
              slug: t.slug,
              status: t.status,
              userCount: t.userCount,
              objectCount: t.objectCount,
              createdAtSrc: t.createdAt,
              source: 'sync',
            });
            upserted++;
          }
          const tombstoned = await markMissingAsDeleted(
            instance.id,
            list.tenants.map((t) => t.id),
            scannedAt,
          );
          return {
            ...base,
            ok: true,
            upserted,
            tombstoned,
            latencyMs: Date.now() - start,
          };
        } catch (err: unknown) {
          if (err instanceof InstanceApiError) {
            return {
              ...base,
              ok: false,
              latencyMs: Date.now() - start,
              error: { code: err.code, message: err.message, status: err.status },
            };
          }
          return {
            ...base,
            ok: false,
            latencyMs: Date.now() - start,
            error: {
              code: 'INTERNAL',
              message: err instanceof Error ? err.message : 'unknown error',
            },
          };
        }
      },
    );

    const totals = {
      instances: targets.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      tenantsUpserted: results.reduce((s, r) => s + (r.upserted ?? 0), 0),
      tenantsTombstoned: results.reduce((s, r) => s + (r.tombstoned ?? 0), 0),
    };

    await logAudit(
      admin.id,
      admin.email,
      'tenants.sync',
      'instance',
      onlyInstance ?? null,
      totals,
      getClientIp(req),
    );

    return NextResponse.json({
      scannedAt: scannedAt.toISOString(),
      totals,
      results,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[tenants/sync]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
