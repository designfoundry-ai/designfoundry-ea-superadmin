'use client';

import { useEffect, useState } from 'react';
import { CreditCard, AlertTriangle, Info, RefreshCw, Loader2 } from 'lucide-react';
import {
  getBillingOverview, getFailedPayments,
  type BillingOverview, type FailedPayment,
} from '@/lib/api';
import { clsx } from 'clsx';

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold text-slate-900 mt-2">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function BillingPage() {
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [failed, setFailed] = useState<FailedPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [o, f] = await Promise.all([getBillingOverview(), getFailedPayments()]);
      setOverview(o);
      setFailed(f);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load billing');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <CreditCard className="w-6 h-6 text-slate-700" />
          <h1 className="text-2xl font-semibold text-slate-900">Billing</h1>
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

      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm mb-6">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Stripe integration pending</p>
          <p className="text-xs mt-0.5 text-amber-700">
            Numbers below come from the billing API but reflect zero state until Stripe webhooks
            are wired up. Failed payments and refunds are not yet operational.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-6">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && !overview ? (
        <div className="grid grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-3 bg-slate-100 rounded w-24 mb-3" />
              <div className="h-7 bg-slate-100 rounded w-20" />
            </div>
          ))}
        </div>
      ) : overview ? (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              label="Active MRR"
              value={formatCurrency(overview.activeMRR)}
              sub="Monthly recurring revenue"
            />
            <StatCard
              label="Net New MRR"
              value={formatCurrency(overview.netNewMRR)}
              sub="This month"
            />
            <StatCard
              label="Churned MRR"
              value={formatCurrency(overview.churnedMRR)}
              sub="This month"
            />
            <StatCard
              label="ARPU"
              value={formatCurrency(overview.arpu)}
              sub="Avg revenue per user"
            />
            <StatCard
              label="LTV"
              value={formatCurrency(overview.ltv)}
              sub="Lifetime value"
            />
            <StatCard
              label="Trial → Paid"
              value={`${(overview.trialConversionRate * 100).toFixed(1)}%`}
              sub="Conversion rate"
            />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-700">Failed Payments</h2>
              <span className="text-xs text-slate-500">{failed.length} total</span>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-2 font-medium text-slate-500">Tenant</th>
                  <th className="text-left px-5 py-2 font-medium text-slate-500">Invoice</th>
                  <th className="text-right px-5 py-2 font-medium text-slate-500">Amount</th>
                  <th className="text-left px-5 py-2 font-medium text-slate-500">Failed at</th>
                  <th className="text-left px-5 py-2 font-medium text-slate-500">Retries</th>
                  <th className="text-left px-5 py-2 font-medium text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {failed.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                      No failed payments
                    </td>
                  </tr>
                ) : failed.map(p => (
                  <tr key={p.invoiceId} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">{p.tenantName}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">{p.invoiceId}</td>
                    <td className="px-5 py-3 text-right text-slate-700">
                      {formatCurrency(p.amount, p.currency)}
                    </td>
                    <td className="px-5 py-3 text-slate-500">
                      {new Date(p.failedAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-slate-500">{p.retryCount}</td>
                    <td className="px-5 py-3">
                      <span className={clsx(
                        'px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                        p.status === 'failed' ? 'bg-red-100 text-red-700'
                          : p.status === 'retrying' ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-600',
                      )}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      )}
    </div>
  );
}
