'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users, Search, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { getAllUsers, disableUser, enableUser, type User, type UserFilters } from '@/lib/api';
import { clsx } from 'clsx';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<UserFilters>({ page: 1, limit: 50 });
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async (f: UserFilters) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAllUsers(f);
      setUsers(result.users);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); }, [load, filters]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setFilters(prev => ({ ...prev, page: 1, search }));
  }

  async function toggleUser(u: User) {
    setActionLoading(u.id);
    try {
      if (u.status === 'active') await disableUser(u.id);
      else await enableUser(u.id);
      await load(filters);
    } catch { /* toast */ }
    setActionLoading(null);
  }

  const totalPages = Math.ceil(total / (filters.limit ?? 50));

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <Users className="w-6 h-6 text-slate-700" />
        <h1 className="text-2xl font-semibold text-slate-900">All Users</h1>
        <span className="text-sm text-slate-500">({total.toLocaleString()} total)</span>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or email…"
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
          <option value="disabled">Disabled</option>
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
              <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Tenant</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Role</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Joined</th>
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
            {!loading && users.map(u => (
              <tr key={`${u.tenantId}-${u.id}`} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{u.name || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-slate-600">{u.tenantName}</td>
                <td className="px-4 py-3 text-slate-600 capitalize">{u.role}</td>
                <td className="px-4 py-3">
                  <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium',
                    u.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => toggleUser(u)}
                    disabled={actionLoading === u.id}
                    className={clsx('text-xs font-medium disabled:opacity-50',
                      u.status === 'active' ? 'text-red-600 hover:text-red-800' : 'text-emerald-600 hover:text-emerald-800')}
                  >
                    {u.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">No users found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-slate-500">
            Showing {((filters.page ?? 1) - 1) * (filters.limit ?? 50) + 1}–
            {Math.min((filters.page ?? 1) * (filters.limit ?? 50), total)} of {total}
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
