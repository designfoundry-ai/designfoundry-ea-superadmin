'use client';

import { useEffect, useState, useCallback } from 'react';
import { KeyRound, Plus, Download, AlertTriangle, X, Check } from 'lucide-react';
import {
  getLicenses, generateLicense, revokeLicense,
  type License, type GenerateLicenseInput,
} from '@/lib/api';
import { clsx } from 'clsx';

const STATUS_COLOR: Record<string, string> = {
  active:   'bg-emerald-100 text-emerald-700',
  expiring: 'bg-amber-100 text-amber-700',
  expired:  'bg-red-100 text-red-700',
  revoked:  'bg-slate-100 text-slate-500',
};

const PLANS = ['free', 'team', 'professional', 'enterprise'];

function GenerateModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<GenerateLicenseInput>({
    customerName: '',
    contactEmail: '',
    plan: 'team',
    deliveryModel: 'on_prem',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await generateLicense(form);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate license');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Generate License</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Customer Name</label>
              <input
                type="text" required
                value={form.customerName}
                onChange={e => setForm(p => ({ ...p, customerName: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Acme Corp"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Contact Email</label>
              <input
                type="email" required
                value={form.contactEmail}
                onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="it@acme.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Plan</label>
              <select
                value={form.plan}
                onChange={e => setForm(p => ({ ...p, plan: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {PLANS.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Delivery</label>
              <select
                value={form.deliveryModel ?? 'on_prem'}
                onChange={e => setForm(p => ({ ...p, deliveryModel: e.target.value as 'saas' | 'on_prem' | 'dev' }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="on_prem">On-Premises</option>
                <option value="saas">SaaS</option>
                <option value="dev">Dev</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Max Users (optional)</label>
              <input
                type="number" min={1}
                value={form.maxUsers ?? ''}
                onChange={e => setForm(p => ({ ...p, maxUsers: e.target.value ? parseInt(e.target.value) : undefined }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Plan default"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Expiry Date (optional)</label>
              <input
                type="date"
                value={form.expiresAt ?? ''}
                onChange={e => setForm(p => ({ ...p, expiresAt: e.target.value || undefined }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tenant Slug (optional)</label>
              <input
                type="text"
                value={form.tenantSlug ?? ''}
                onChange={e => setForm(p => ({ ...p, tenantSlug: e.target.value || undefined }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="for existing SaaS tenant"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium
                         hover:bg-indigo-700 disabled:opacity-50">
              {loading ? 'Generating…' : 'Generate License'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LicensesPage() {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getLicenses();
      setLicenses(result.licenses);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load licenses');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRevoke(id: string) {
    setActionLoading(id);
    try {
      await revokeLicense(id);
      await load();
    } catch { /* toast */ }
    setActionLoading(null);
    setRevokeTarget(null);
  }

  function downloadLicense(id: string) {
    window.open(`/api/licenses/${id}/download`, '_blank');
  }

  return (
    <div className="p-8">
      {showGenerate && (
        <GenerateModal onClose={() => setShowGenerate(false)} onSuccess={load} />
      )}

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <KeyRound className="w-6 h-6 text-slate-700" />
          <h1 className="text-2xl font-semibold text-slate-900">Licenses</h1>
          <span className="text-sm text-slate-500">({total.toLocaleString()} total)</span>
        </div>
        <button
          onClick={() => setShowGenerate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" /> Generate License
        </button>
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
              <th className="text-left px-4 py-3 font-medium text-slate-600">Customer</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Plan</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Type</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Issued</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Expires</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && [...Array(4)].map((_, i) => (
              <tr key={i}>
                {[...Array(7)].map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 bg-slate-100 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))}
            {!loading && licenses.map(lic => (
              <tr key={lic.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium text-slate-900">{lic.companyName}</p>
                    <p className="text-xs text-slate-400">{lic.contactEmail}</p>
                  </div>
                </td>
                <td className="px-4 py-3 capitalize text-slate-700">{lic.tier}</td>
                <td className="px-4 py-3 text-slate-500">{lic.isOnPrem ? 'On-Prem' : 'SaaS'}</td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(lic.validFrom).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {lic.validUntil ? new Date(lic.validUntil).toLocaleDateString() : '∞ Perpetual'}
                </td>
                <td className="px-4 py-3">
                  <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                    STATUS_COLOR[lic.status] ?? 'bg-slate-100 text-slate-600')}>
                    {lic.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {lic.isOnPrem && (
                      <button
                        onClick={() => downloadLicense(lic.id)}
                        className="text-indigo-600 hover:text-indigo-800"
                        title="Download .lic"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                    {lic.status !== 'revoked' && (
                      <>
                        {revokeTarget === lic.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleRevoke(lic.id)}
                              disabled={actionLoading === lic.id}
                              className="text-red-600 hover:text-red-800 disabled:opacity-50"
                              title="Confirm revoke"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={() => setRevokeTarget(null)}
                              className="text-slate-400 hover:text-slate-600">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setRevokeTarget(lic.id)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            Revoke
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && licenses.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No licenses yet — generate your first one
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
