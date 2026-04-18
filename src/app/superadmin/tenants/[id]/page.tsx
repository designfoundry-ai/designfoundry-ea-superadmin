'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, AlertTriangle, Building2, Users, LayoutGrid,
  BarChart3, Pause, Play, Trash2
} from 'lucide-react';
import { getTenant, getTenantUsers, suspendTenant, activateTenant, type Tenant, type User } from '@/lib/api';
import { clsx } from 'clsx';

type Tab = 'overview' | 'users' | 'settings';

const STATUS_COLOR: Record<string, string> = {
  active:    'text-emerald-600',
  trial:     'text-amber-600',
  suspended: 'text-red-600',
  canceled:  'text-slate-500',
  cancelled: 'text-slate-500',
};

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getTenant(id)
      .then(t => { setTenant(t); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [id]);

  useEffect(() => {
    if (activeTab === 'users' && tenant) {
      getTenantUsers(id).then(r => setUsers(r.users)).catch(() => {});
    }
  }, [activeTab, id, tenant]);

  async function handleSuspend() {
    if (!tenant) return;
    setActionLoading(true);
    await suspendTenant(id).catch(() => {});
    const updated = await getTenant(id).catch(() => null);
    if (updated) setTenant(updated);
    setActionLoading(false);
  }

  async function handleActivate() {
    if (!tenant) return;
    setActionLoading(true);
    await activateTenant(id).catch(() => {});
    const updated = await getTenant(id).catch(() => null);
    if (updated) setTenant(updated);
    setActionLoading(false);
  }

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
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={clsx('text-sm font-medium capitalize', STATUS_COLOR[tenant.status])}>
              {tenant.status}
            </span>
            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium capitalize">
              {tenant.plan}
            </span>
            {tenant.status !== 'suspended' ? (
              <button
                onClick={handleSuspend}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-700
                           rounded-lg text-sm font-medium hover:bg-amber-200 disabled:opacity-50"
              >
                <Pause className="w-3.5 h-3.5" /> Suspend
              </button>
            ) : (
              <button
                onClick={handleActivate}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 text-emerald-700
                           rounded-lg text-sm font-medium hover:bg-emerald-200 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" /> Activate
              </button>
            )}
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
