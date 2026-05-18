'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Building2,
  Search,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Loader2,
  Server,
  CheckCircle2,
} from 'lucide-react';
import {
  getTenants,
  listInstances,
  syncTenantsFromInstances,
  type Tenant,
  type TenantFilters,
  type TenantList,
  type TenantsSyncResponse,
  type Instance,
} from '@/lib/api';
import { clsx } from 'clsx';

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-700',
  trial:     'bg-amber-100 text-amber-700',
  suspended: 'bg-red-100 text-red-700',
  canceled:  'bg-slate-100 text-slate-600',
  cancelled: 'bg-slate-100 text-slate-600',
  unknown:   'bg-slate-100 text-slate-500',
};

const PLAN_BADGE: Record<string, string> = {
  free:         'bg-slate-100 text-slate-600',
  team:         'bg-blue-100 text-blue-700',
  professional: 'bg-purple-100 text-purple-700',
  enterprise:   'bg-indigo-100 text-indigo-700',
  unknown:      'bg-slate-50 text-slate-500',
};

const ENV_BADGE: Record<string, string> = {
  production: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  staging:    'bg-blue-50 text-blue-700 border-blue-200',
  dev:        'bg-slate-50 text-slate-600 border-slate-200',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium capitalize',
      STATUS_BADGE[status] ?? 'bg-slate-100 text-slate-600')}>
      {status}
    </span>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium capitalize',
      PLAN_BADGE[plan] ?? 'bg-slate-100 text-slate-600')}>
      {plan}
    </span>
  );
}

function InstanceTag({ name, environment }: { name: string; environment: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs border',
      ENV_BADGE[environment] ?? 'bg-slate-50 text-slate-600 border-slate-200')}>
      <Server className="w-3 h-3" />
      <span className="font-medium">{name}</span>
      <span className="uppercase opacity-60">{environment}</span>
    </span>
  );
}

function relativeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.round(hr / 24)} d ago`;
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [cacheMeta, setCacheMeta] = useState<TenantList['cache'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TenantFilters>({ page: 1, limit: 25 });
  const [search, setSearch] = useState('');

  // Sync now — single-click full pull from every active instance.
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<TenantsSyncResponse | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // For the instance filter dropdown.
  const [instances, setInstances] = useState<Instance[]>([]);

  const load = useCallback(async (f: TenantFilters) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getTenants(f);
      setTenants(result.tenants);
      setTotal(result.total);
      setCacheMeta(result.cache ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); }, [load, filters]);

  useEffect(() => {
    listInstances()
      .then(r => setInstances(r.instances))
      .catch(() => setInstances([]));
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setFilters(prev => ({ ...prev, page: 1, search }));
  }

  async function handleSync() {
    setSyncLoading(true);
    setSyncError(null);
    try {
      const result = await syncTenantsFromInstances();
      setSyncResult(result);
      await load(filters); // refresh list with new cache contents
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncLoading(false);
    }
  }

  const totalPages = Math.ceil(total / (filters.limit ?? 25));

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Building2 className="w-6 h-6 text-slate-700" />
          <h1 className="text-2xl font-semibold text-slate-900">Tenants</h1>
          <span className="text-sm text-slate-500">({total.toLocaleString()} total)</span>
        </div>
        <button
          onClick={handleSync}
          disabled={syncLoading}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700
                     bg-white border border-slate-200 rounded-lg hover:bg-slate-50
                     disabled:opacity-50 disabled:cursor-not-allowed"
          title="Pull latest tenant data from every active instance and update the cache"
        >
          {syncLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Sync now
        </button>
      </div>

      {/* Freshness + sync status line */}
      <div className="flex items-center gap-3 mb-6 text-xs text-slate-500">
        <span>
          Cache: {cacheMeta?.liveRows ?? 0} live
          {cacheMeta?.deletedRows ? ` · ${cacheMeta.deletedRows} tombstoned` : ''}
          {' · last synced '}
          {relativeAgo(cacheMeta?.newestSyncedAt ?? null)}
          {cacheMeta?.newestEventAt && ` · last event ${relativeAgo(cacheMeta.newestEventAt)}`}
        </span>
        {syncResult && (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <CheckCircle2 className="w-3 h-3" />
            Sync: {syncResult.totals.ok}/{syncResult.totals.instances} instances
            {' · '}{syncResult.totals.tenantsUpserted} upserted
            {syncResult.totals.tenantsTombstoned > 0
              && ` · ${syncResult.totals.tenantsTombstoned} tombstoned`}
            {syncResult.totals.skipped > 0 && ` · ${syncResult.totals.skipped} skipped`}
            {syncResult.totals.failed > 0 && (
              <span className="text-red-600">{` · ${syncResult.totals.failed} failed`}</span>
            )}
          </span>
        )}
        {syncError && (
          <span className="inline-flex items-center gap-1 text-red-600">
            <AlertTriangle className="w-3 h-3" />
            {syncError}
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tenants…"
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button type="submit"
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
            Search
          </button>
        </form>

        <select
          value={filters.instance ?? ''}
          onChange={e => setFilters(prev => ({ ...prev, page: 1, instance: e.target.value || undefined }))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All instances</option>
          {instances.map(i => (
            <option key={i.id} value={i.id}>{i.name} ({i.environment})</option>
          ))}
        </select>

        <select
          value={filters.status ?? ''}
          onChange={e => setFilters(prev => ({ ...prev, page: 1, status: e.target.value || undefined }))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="suspended">Suspended</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          value={filters.plan ?? ''}
          onChange={e => setFilters(prev => ({ ...prev, page: 1, plan: e.target.value || undefined }))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="team">Team</option>
          <option value="professional">Professional</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Tenant</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Instance</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Plan</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600">Users</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600">Objects</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Last seen</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && [...Array(5)].map((_, i) => (
              <tr key={i}>
                {[...Array(8)].map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 bg-slate-100 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))}
            {!loading && tenants.map(t => (
              <tr key={`${t.instanceId}:${t.id}`} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div>
                    <Link href={`/superadmin/tenants/${t.id}?instance=${t.instanceId}`}
                      className="font-medium text-slate-900 hover:text-indigo-600">{t.name}</Link>
                    <p className="text-xs text-slate-400">{t.slug}</p>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <InstanceTag name={t.instanceName} environment={t.instanceEnvironment} />
                </td>
                <td className="px-4 py-3"><PlanBadge plan={t.plan} /></td>
                <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-3 text-right text-slate-700">{t.usersCount.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-700">{t.objectsCount.toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-500" title={t.lastSeenAt ?? ''}>
                  {relativeAgo(t.lastSeenAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/superadmin/tenants/${t.id}?instance=${t.instanceId}`}
                    className="text-indigo-600 hover:text-indigo-800 font-medium text-xs">View</Link>
                </td>
              </tr>
            ))}
            {!loading && tenants.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  <p className="text-slate-400 text-sm mb-3">
                    No tenants in cache.{' '}
                    {(cacheMeta?.newestSyncedAt ?? null) === null
                      ? 'Click "Sync now" to populate from active instances.'
                      : 'Try clearing filters or running a sync.'}
                  </p>
                  <button
                    onClick={handleSync}
                    disabled={syncLoading}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {syncLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Sync now
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-slate-500">
            Showing {((filters.page ?? 1) - 1) * (filters.limit ?? 25) + 1}–
            {Math.min((filters.page ?? 1) * (filters.limit ?? 25), total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilters(prev => ({ ...prev, page: (prev.page ?? 1) - 1 }))}
              disabled={(filters.page ?? 1) <= 1}
              className="p-1.5 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-slate-600">{filters.page} / {totalPages}</span>
            <button
              onClick={() => setFilters(prev => ({ ...prev, page: (prev.page ?? 1) + 1 }))}
              disabled={(filters.page ?? 1) >= totalPages}
              className="p-1.5 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
