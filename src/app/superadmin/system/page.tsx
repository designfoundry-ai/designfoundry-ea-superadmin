'use client';

import { useEffect, useState } from 'react';
import { Server, AlertTriangle, RefreshCw } from 'lucide-react';
import { getSystemHealth, type SystemHealth } from '@/lib/api';
import { clsx } from 'clsx';

const SERVICE_COLOR: Record<string, string> = {
  healthy:  'bg-emerald-100 text-emerald-700',
  degraded: 'bg-amber-100 text-amber-700',
  down:     'bg-red-100 text-red-700',
};

function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', className)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 w-10 text-right">{pct}%</span>
    </div>
  );
}

export default function SystemPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await getSystemHealth();
      setHealth(result);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load system health');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const overallStatus = health?.services.some(s => s.status === 'down')
    ? 'down'
    : health?.services.some(s => s.status === 'degraded')
    ? 'degraded'
    : 'healthy';

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Server className="w-6 h-6 text-slate-700" />
          <h1 className="text-2xl font-semibold text-slate-900">System Health</h1>
          {health && (
            <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium capitalize',
              SERVICE_COLOR[overallStatus])}>
              {overallStatus}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-xs text-slate-400">
              Updated {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-6">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && !health && (
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-4 bg-slate-100 rounded w-32 mb-3" />
              <div className="h-8 bg-slate-100 rounded w-20" />
            </div>
          ))}
        </div>
      )}

      {health && (
        <div className="space-y-6">
          {/* Services */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
              <h2 className="text-sm font-medium text-slate-700">Services</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-2 font-medium text-slate-500">Service</th>
                  <th className="text-left px-5 py-2 font-medium text-slate-500">Status</th>
                  <th className="text-right px-5 py-2 font-medium text-slate-500">Latency</th>
                  <th className="text-right px-5 py-2 font-medium text-slate-500">Uptime</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {health.services.map(svc => (
                  <tr key={svc.name} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{svc.name}</td>
                    <td className="px-5 py-3">
                      <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                        SERVICE_COLOR[svc.status])}>
                        {svc.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">{svc.latencyMs}ms</td>
                    <td className="px-5 py-3 text-right text-slate-500">{svc.uptime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h2 className="text-sm font-medium text-slate-700">Database Connections</h2>
              <p className="text-2xl font-semibold text-slate-900">
                {health.metrics.dbConnections.current}
                <span className="text-base font-normal text-slate-400"> / {health.metrics.dbConnections.max}</span>
              </p>
              <Bar
                value={health.metrics.dbConnections.current}
                max={health.metrics.dbConnections.max}
                className={health.metrics.dbConnections.current / health.metrics.dbConnections.max > 0.8
                  ? 'bg-amber-400' : 'bg-emerald-400'}
              />
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h2 className="text-sm font-medium text-slate-700">API Error Rate</h2>
              <p className="text-2xl font-semibold text-slate-900">
                {health.metrics.apiErrorRate.toFixed(2)}%
              </p>
              <Bar
                value={health.metrics.apiErrorRate}
                max={10}
                className={health.metrics.apiErrorRate > 5 ? 'bg-red-400'
                  : health.metrics.apiErrorRate > 1 ? 'bg-amber-400' : 'bg-emerald-400'}
              />
            </div>

            {health.metrics.diskUsage && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <h2 className="text-sm font-medium text-slate-700">Disk Usage</h2>
                <p className="text-2xl font-semibold text-slate-900">
                  {health.metrics.diskUsage.used}
                  <span className="text-base font-normal text-slate-400"> / {health.metrics.diskUsage.max} GB</span>
                </p>
                <Bar
                  value={health.metrics.diskUsage.used}
                  max={health.metrics.diskUsage.max}
                  className={health.metrics.diskUsage.used / health.metrics.diskUsage.max > 0.9
                    ? 'bg-red-400' : 'bg-indigo-400'}
                />
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h2 className="text-sm font-medium text-slate-700">Requests / min</h2>
              <p className="text-2xl font-semibold text-slate-900">
                {health.metrics.apiRequestsPerMin.toLocaleString()}
              </p>
              <p className="text-xs text-slate-400">Current rate</p>
            </div>
          </div>

          {/* Deployment info */}
          {health.deployment && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-medium text-slate-700 mb-3">Deployment</h2>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-slate-400">Version</dt>
                  <dd className="text-slate-700 font-medium">{health.deployment.version}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Commit</dt>
                  <dd className="font-mono text-xs text-slate-700">{health.deployment.commit}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Deployed at</dt>
                  <dd className="text-slate-700">{new Date(health.deployment.deployedAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Service</dt>
                  <dd className="text-slate-700">{health.deployment.service}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Deployed by</dt>
                  <dd className="text-slate-700">{health.deployment.deployedBy}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Status</dt>
                  <dd className={clsx('font-medium capitalize',
                    health.deployment.status === 'success' ? 'text-emerald-600' : 'text-red-600')}>
                    {health.deployment.status}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
