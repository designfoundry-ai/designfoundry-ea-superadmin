'use client';

import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { getAdminAuditLog, type AdminAuditEntry, type AdminAuditFilters } from '@/lib/api';

const ACTIONS = [
  '', 'LOGIN', 'LOGOUT',
  'TENANT_SUSPEND', 'TENANT_ACTIVATE', 'TENANT_DELETE',
  'USER_DISABLE', 'USER_ENABLE',
  'LICENSE_GENERATE', 'LICENSE_REVOKE',
  'SETTINGS_UPDATE', 'FEATURE_FLAG_UPDATE',
];

export default function AuditPage() {
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AdminAuditFilters>({ page: 1, limit: 50 });

  const load = useCallback(async (f: AdminAuditFilters) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAdminAuditLog(f);
      setEntries(result.entries);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); }, [load, filters]);

  const totalPages = Math.ceil(total / (filters.limit ?? 50));

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <ShieldCheck className="w-6 h-6 text-slate-700" />
        <h1 className="text-2xl font-semibold text-slate-900">Admin Audit Log</h1>
        <span className="text-sm text-slate-500">({total.toLocaleString()} entries)</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <select
          value={filters.action ?? ''}
          onChange={e => setFilters(p => ({ ...p, page: 1, action: e.target.value || undefined }))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All actions</option>
          {ACTIONS.filter(Boolean).map(a => (
            <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
          ))}
        </select>

        <input
          type="date"
          value={filters.from ?? ''}
          onChange={e => setFilters(p => ({ ...p, page: 1, from: e.target.value || undefined }))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <span className="text-slate-400 text-sm">to</span>
        <input
          type="date"
          value={filters.to ?? ''}
          onChange={e => setFilters(p => ({ ...p, page: 1, to: e.target.value || undefined }))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
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
              <th className="text-left px-4 py-3 font-medium text-slate-600">Time</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Admin</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Target</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Details</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && [...Array(8)].map((_, i) => (
              <tr key={i}>
                {[...Array(6)].map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 bg-slate-100 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))}
            {!loading && entries.map(e => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <p className="text-slate-700 font-medium">{e.adminEmail}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{e.action}</td>
                <td className="px-4 py-3 text-slate-500">
                  {e.targetType && <span className="capitalize">{e.targetType}</span>}
                  {e.targetId && <span className="block font-mono text-xs text-slate-400 truncate max-w-[120px]">{e.targetId}</span>}
                  {!e.targetType && '—'}
                </td>
                <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{e.details ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{e.ipAddress}</td>
              </tr>
            ))}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">No audit entries found</td>
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
              onClick={() => setFilters(p => ({ ...p, page: (p.page ?? 1) - 1 }))}
              disabled={(filters.page ?? 1) <= 1}
              className="p-1.5 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-slate-600">{filters.page} / {totalPages}</span>
            <button
              onClick={() => setFilters(p => ({ ...p, page: (p.page ?? 1) + 1 }))}
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
