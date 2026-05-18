'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft, AlertTriangle, Building2, Users, LayoutGrid,
  BarChart3, Trash2, Server, CheckCircle2, Clock, RefreshCw, Loader2,
} from 'lucide-react';
import { getTenant, type TenantDetail } from '@/lib/api';
import { clsx } from 'clsx';

type Tab = 'overview' | 'users' | 'settings';

const STATUS_COLOR: Record<string, string> = {
  active:    'text-emerald-600',
  trial:     'text-amber-600',
  suspended: 'text-red-600',
  canceled:  'text-slate-500',
  cancelled: 'text-slate-500',
  unknown:   'text-slate-400',
};

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

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const instanceHint = searchParams.get('instance') ?? undefined;
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  async function reload() {
    setRefreshing(true);
    try {
      const fresh = await getTenant(id, { instance: instanceHint });
      setTenant(fresh);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tenant');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, instanceHint]);

  const users = tenant?.users ?? [];

  if (loading) {
    return (
      <div className="p-8 animate-pulse space-y-4">
        <div className="h-6 bg-slate-200 rounded w-64" />
        <div className="h-32 bg-slate-200 rounded-xl" />
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="p-8 text-center text-red-600">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
        <p>{error || 'Tenant not found'}</p>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="p-8">
      <Link href="/superadmin/tenants"
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to Tenants
      </Link>

      {/* Freshness banner — shows whether data is live from the instance or
          a cache fallback because the instance is unreachable. */}
      {tenant._freshness && (
        <div
          className={clsx(
            'mb-4 px-3 py-2 rounded-lg text-xs flex items-center gap-2 border',
            tenant._freshness.source === 'live'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-amber-50 border-amber-200 text-amber-700',
          )}
        >
          {tenant._freshness.source === 'live' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <Clock className="w-4 h-4 shrink-0" />
          )}
          <div className="flex-1">
            {tenant._freshness.source === 'live' ? (
              <>
                Live from <strong>{tenant._freshness.instance.name}</strong> — fetched {relativeAgo(tenant._freshness.fetchedAt)}
              </>
            ) : (
              <>
                Cache fallback — <strong>{tenant._freshness.instance.name}</strong> unreachable
                {tenant._freshness.error?.message && <> ({tenant._freshness.error.message})</>}.
                {' '}Last synced {relativeAgo(tenant._freshness.cacheAge?.lastSyncedAt)}
                {tenant._freshness.cacheAge?.lastEventAt
                  && <>, last event {relativeAgo(tenant._freshness.cacheAge.lastEventAt)}</>}.
              </>
            )}
          </div>
          <button
            onClick={reload}
            disabled={refreshing}
            className="ml-3 inline-flex items-center gap-1 px-2 py-1 rounded border border-current/30 hover:bg-white/30 disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
              <Building2 className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{tenant.name}</h1>
              <p className="text-sm text-slate-400">{tenant.slug}</p>
              {tenant.primaryEmail && (
                <p className="text-sm text-slate-500">{tenant.primaryEmail}</p>
              )}
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Server className="w-3 h-3" />
                Lives on <strong className="text-slate-700">{tenant.instanceName}</strong>
                <span className="uppercase opacity-60">{tenant.instanceEnvironment}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={clsx('text-sm font-medium capitalize', STATUS_COLOR[tenant.status])}>
              {tenant.status}
            </span>
            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium capitalize">
              {tenant.plan}
            </span>
            <span className="text-xs text-slate-400 italic">
              Lifecycle actions: edit on the instance
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-6">
        <nav className="flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Users', value: tenant.usersCount, icon: Users },
              { label: 'Objects', value: tenant.objectsCount, icon: LayoutGrid },
              { label: 'Diagrams', value: tenant.diagramsCount, icon: BarChart3 },
              { label: 'MRR', value: `$${tenant.mrr}`, icon: Building2 },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-4 h-4 text-slate-400" />
                  <span className="text-sm text-slate-500">{label}</span>
                </div>
                <p className="text-2xl font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-medium text-slate-700 mb-3">Details</h3>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-400">Created</dt><dd className="text-slate-700">{new Date(tenant.createdAt).toLocaleDateString()}</dd></div>
              <div><dt className="text-slate-400">Last Active</dt><dd className="text-slate-700">{new Date(tenant.lastActiveAt).toLocaleDateString()}</dd></div>
              <div><dt className="text-slate-400">Plan</dt><dd className="text-slate-700 capitalize">{tenant.plan}</dd></div>
              <div><dt className="text-slate-400">Status</dt><dd className={clsx('capitalize font-medium', STATUS_COLOR[tenant.status])}>{tenant.status}</dd></div>
              {tenant.trialEndsAt && (
                <div><dt className="text-slate-400">Trial Ends</dt><dd className="text-slate-700">{new Date(tenant.trialEndsAt).toLocaleDateString()}</dd></div>
              )}
            </dl>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No users</td></tr>
              )}
              {users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{u.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="px-4 py-3 text-slate-600 capitalize">{u.role}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium',
                      u.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-medium text-slate-700 mb-3">Tenant Info</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Tenant ID</dt>
                <dd className="font-mono text-slate-700 text-xs">{tenant.id}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Slug</dt>
                <dd className="text-slate-700">{tenant.slug}</dd>
              </div>
            </dl>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <h3 className="text-sm font-medium text-red-700 mb-3 flex items-center gap-2">
              <Trash2 className="w-4 h-4" /> Danger Zone
            </h3>
            <p className="text-xs text-red-600 mb-3">
              Deleting a tenant permanently drops their schema and all data. This cannot be undone.
            </p>
            <Link href={`/superadmin/tenants/${tenant.id}/delete`}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700">
              Delete Tenant…
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
