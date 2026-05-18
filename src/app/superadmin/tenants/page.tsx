'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Building2,
  Search,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Server,
  X,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import {
  getTenants,
  suspendTenant,
  activateTenant,
  discoverInstanceTenants,
  type Tenant,
  type TenantFilters,
  type DiscoverTenantsResponse,
} from '@/lib/api';
import { clsx } from 'clsx';

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-700',
  trial:     'bg-amber-100 text-amber-700',
  suspended: 'bg-red-100 text-red-700',
  canceled:  'bg-slate-100 text-slate-600',
  cancelled: 'bg-slate-100 text-slate-600',
};

const PLAN_BADGE: Record<string, string> = {
  free:         'bg-slate-100 text-slate-600',
  team:         'bg-blue-100 text-blue-700',
  professional: 'bg-purple-100 text-purple-700',
  enterprise:   'bg-indigo-100 text-indigo-700',
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

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TenantFilters>({ page: 1, limit: 25 });
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // "Discover from instances" — fan-out to every active instance.
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverData, setDiscoverData] = useState<DiscoverTenantsResponse | null>(null);

  async function runDiscover() {
    setDiscoverOpen(true);
    setDiscoverLoading(true);
    setDiscoverError(null);
    setDiscoverData(null);
    try {
      const result = await discoverInstanceTenants();
      setDiscoverData(result);
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : 'Failed to discover tenants');
    } finally {
      setDiscoverLoading(false);
    }
  }

  const load = useCallback(async (f: TenantFilters) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getTenants(f);
      setTenants(result.tenants);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); }, [load, filters]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setFilters(prev => ({ ...prev, page: 1, search }));
  }

  async function handleSuspend(id: string) {
    setActionLoading(id);
    try {
      await suspendTenant(id);
      await load(filters);
    } catch { /* toast error */ }
    setActionLoading(null);
  }

  async function handleActivate(id: string) {
    setActionLoading(id);
    try {
      await activateTenant(id);
      await load(filters);
    } catch { /* toast error */ }
    setActionLoading(null);
  }

  const totalPages = Math.ceil(total / (filters.limit ?? 25));

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Building2 className="w-6 h-6 text-slate-700" />
          <h1 className="text-2xl font-semibold text-slate-900">Tenants</h1>
          <span className="text-sm text-slate-500">({total.toLocaleString()} total)</span>
        </div>
        <button
          onClick={runDiscover}
          disabled={discoverLoading}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700
                     bg-white border border-slate-200 rounded-lg hover:bg-slate-50
                     disabled:opacity-50 disabled:cursor-not-allowed"
          title="Query every active instance for its tenant list and aggregate the results"
        >
          {discoverLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Server className="w-4 h-4" />
          )}
          Discover from instances
        </button>
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
              <th className="text-left px-4 py-3 font-medium text-slate-600">Plan</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600">Users</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600">Objects</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Created</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && [...Array(5)].map((_, i) => (
              <tr key={i}>
                {[...Array(7)].map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 bg-slate-100 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))}
            {!loading && tenants.map(t => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div>
                    <Link href={`/superadmin/tenants/${t.id}`}
                      className="font-medium text-slate-900 hover:text-indigo-600">{t.name}</Link>
                    <p className="text-xs text-slate-400">{t.slug}</p>
                  </div>
                </td>
                <td className="px-4 py-3"><PlanBadge plan={t.plan} /></td>
                <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-3 text-right text-slate-700">{t.usersCount.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-700">{t.objectsCount.toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(t.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link href={`/superadmin/tenants/${t.id}`}
                      className="text-indigo-600 hover:text-indigo-800 font-medium text-xs">View</Link>
                    {t.status !== 'suspended' ? (
                      <button
                        onClick={() => handleSuspend(t.id)}
                        disabled={actionLoading === t.id}
                        className="text-amber-600 hover:text-amber-800 font-medium text-xs disabled:opacity-50"
                      >
                        Suspend
                      </button>
                    ) : (
                      <button
                        onClick={() => handleActivate(t.id)}
                        disabled={actionLoading === t.id}
                        className="text-emerald-600 hover:text-emerald-800 font-medium text-xs disabled:opacity-50"
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && tenants.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No tenants found
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

      {discoverOpen && (
        <DiscoverInstancesModal
          loading={discoverLoading}
          error={discoverError}
          data={discoverData}
          onClose={() => setDiscoverOpen(false)}
          onRetry={runDiscover}
        />
      )}
    </div>
  );
}

interface DiscoverInstancesModalProps {
  loading: boolean;
  error: string | null;
  data: DiscoverTenantsResponse | null;
  onClose: () => void;
  onRetry: () => void;
}

function DiscoverInstancesModal({
  loading,
  error,
  data,
  onClose,
  onRetry,
}: DiscoverInstancesModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <Server className="w-5 h-5 text-slate-700" />
            <h2 className="text-lg font-semibold text-slate-900">
              Tenants across active instances
            </h2>
            {data && (
              <span className="text-xs text-slate-500">
                {data.totals.ok}/{data.totals.instances} instances replied · {data.totals.tenants} tenants found
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Querying instances…
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p>{error}</p>
                <button
                  onClick={onRetry}
                  className="mt-2 text-xs font-medium text-red-700 underline hover:text-red-800"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {!loading && !error && data && data.results.length === 0 && (
            <p className="text-sm text-slate-500 py-6 text-center">
              No active instances to query. Approve a self-registered instance first.
            </p>
          )}

          {!loading && !error && data && data.results.length > 0 && (
            <div className="space-y-3">
              {data.results.map((r) => (
                <details
                  key={r.instanceId}
                  className="rounded-lg border border-slate-200 bg-slate-50 open:bg-white"
                >
                  <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-3">
                    {r.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 truncate">
                          {r.instanceName}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 uppercase">
                          {r.environment}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate">{r.instanceUrl}</p>
                    </div>
                    <div className="text-right text-xs text-slate-500 shrink-0">
                      {r.ok ? (
                        <>
                          <span className="font-medium text-slate-700">
                            {r.tenantCount ?? 0} tenants
                          </span>
                          {typeof r.latencyMs === 'number' && (
                            <span className="block">{r.latencyMs} ms</span>
                          )}
                        </>
                      ) : (
                        <span className="text-red-600 font-medium">
                          {r.error?.code ?? 'ERROR'}
                        </span>
                      )}
                    </div>
                  </summary>

                  <div className="px-4 pb-3 text-sm">
                    {r.ok && r.tenants && r.tenants.length > 0 && (
                      <table className="w-full mt-1">
                        <thead>
                          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                            <th className="py-1.5 pr-2 font-medium">Name</th>
                            <th className="py-1.5 px-2 font-medium">Slug</th>
                            <th className="py-1.5 px-2 font-medium">Status</th>
                            <th className="py-1.5 px-2 font-medium text-right">Users</th>
                            <th className="py-1.5 px-2 font-medium text-right">Objects</th>
                            <th className="py-1.5 pl-2 font-medium">Created</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {r.tenants.map((t) => (
                            <tr key={t.id}>
                              <td className="py-1.5 pr-2 text-slate-800">{t.name}</td>
                              <td className="py-1.5 px-2 text-slate-500">{t.slug}</td>
                              <td className="py-1.5 px-2">
                                <span className={clsx(
                                  'px-1.5 py-0.5 rounded-full text-xs font-medium capitalize',
                                  STATUS_BADGE[t.status] ?? 'bg-slate-100 text-slate-600',
                                )}>
                                  {t.status}
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-right text-slate-700">
                                {t.userCount.toLocaleString()}
                              </td>
                              <td className="py-1.5 px-2 text-right text-slate-700">
                                {t.objectCount.toLocaleString()}
                              </td>
                              <td className="py-1.5 pl-2 text-slate-500">
                                {new Date(t.createdAt).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {r.ok && (!r.tenants || r.tenants.length === 0) && (
                      <p className="text-xs text-slate-500 py-2">
                        Instance replied but reported no tenants.
                      </p>
                    )}
                    {!r.ok && r.error && (
                      <p className="text-xs text-red-600 py-2">
                        {r.error.message}
                        {typeof r.error.status === 'number' && ` (HTTP ${r.error.status})`}
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {data?.scannedAt && `Scanned at ${new Date(data.scannedAt).toLocaleString()}`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onRetry}
              disabled={loading}
              className="px-3 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              Re-scan
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm font-medium text-white bg-slate-700 rounded-lg hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
