'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Building2, Search, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { getTenants, suspendTenant, activateTenant, type Tenant, type TenantFilters } from '@/lib/api';
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
    </div>
  );
}
