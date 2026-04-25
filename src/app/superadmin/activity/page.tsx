'use client';

import { useEffect, useState, useCallback } from 'react';
import { Activity, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { getActivity, type ActivityEvent, type ActivityFilters } from '@/lib/api';
import { clsx } from 'clsx';

const SEVERITY_COLOR: Record<string, string> = {
  INFO:    'bg-blue-100 text-blue-700',
  WARNING: 'bg-amber-100 text-amber-700',
  ERROR:   'bg-red-100 text-red-700',
};

const EVENT_TYPES = [
  '', 'TENANT_CREATED', 'TENANT_SUSPENDED', 'TENANT_ACTIVATED',
  'USER_DISABLED', 'USER_ENABLED', 'LICENSE_GENERATED', 'LICENSE_REVOKED',
  'PAYMENT_SUCCEEDED', 'BILLING_PAYMENT_FAILED',
];

export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>({ page: 1, limit: 50 });

  const load = useCallback(async (f: ActivityFilters) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getActivity(f);
      setEvents(result.events);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filters); }, [load, filters]);

  const totalPages = Math.ceil(total / (filters.limit ?? 50));

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <Activity className="w-6 h-6 text-slate-700" />
        <h1 className="text-2xl font-semibold text-slate-900">Platform Activity</h1>
        <span className="text-sm text-slate-500">({total.toLocaleString()} events)</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <select
          value={filters.eventType ?? ''}
          onChange={e => setFilters(p => ({ ...p, page: 1, eventType: e.target.value || undefined }))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All event types</option>
          {EVENT_TYPES.filter(Boolean).map(t => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </select>

        <select
          value={filters.severity ?? ''}
          onChange={e => setFilters(p => ({ ...p, page: 1, severity: e.target.value || undefined }))}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All severities</option>
          <option value="INFO">Info</option>
          <option value="WARNING">Warning</option>
          <option value="ERROR">Error</option>
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
              <th className="text-left px-4 py-3 font-medium text-slate-600">Event</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Severity</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Tenant</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && [...Array(8)].map((_, i) => (
              <tr key={i}>
                {[...Array(5)].map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 bg-slate-100 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))}
            {!loading && events.map(ev => (
              <tr key={ev.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                  {new Date(ev.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{ev.eventType}</td>
                <td className="px-4 py-3">
                  <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium',
                    SEVERITY_COLOR[ev.severity] ?? 'bg-slate-100 text-slate-600')}>
                    {ev.severity}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{ev.tenantName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{ev.details}</td>
              </tr>
            ))}
            {!loading && events.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">No events found</td>
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
