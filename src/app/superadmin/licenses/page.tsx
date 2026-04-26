'use client';

import { useEffect, useState, useCallback } from 'react';
import { KeyRound, Plus, Download, AlertTriangle, X, Check, Send } from 'lucide-react';
import {
  getLicenses, generateLicense, revokeLicense, deliverLicense, listInstances,
  type License, type GenerateLicenseInput, type Instance,
} from '@/lib/api';
import { clsx } from 'clsx';

interface Toast {
  kind: 'success' | 'error';
  message: string;
}

const STATUS_COLOR: Record<string, string> = {
  active:   'bg-emerald-100 text-emerald-700',
  expiring: 'bg-amber-100 text-amber-700',
  expired:  'bg-red-100 text-red-700',
  revoked:  'bg-slate-100 text-slate-500',
};

const PLANS = ['free', 'team', 'professional', 'enterprise'];

function GenerateModal({
  instances,
  onClose,
  onSuccess,
  onToast,
}: {
  instances: Instance[];
  onClose: () => void;
  onSuccess: () => void;
  onToast: (t: Toast) => void;
}) {
  const [form, setForm] = useState<GenerateLicenseInput>({
    customerName: '',
    contactEmail: '',
    plan: 'team',
    deliveryModel: 'on_prem',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isSaas = form.deliveryModel === 'saas';
  const activeInstances = instances.filter(i => i.status === 'active');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await generateLicense(form);
      if (result.delivery.attempted) {
        onToast(result.delivery.ok
          ? { kind: 'success', message: `License delivered to instance (${result.delivery.envelopeId?.slice(0, 8)}…)` }
          : { kind: 'error', message: `License created but delivery failed: ${result.delivery.error ?? 'unknown error'}` });
      } else {
        onToast({ kind: 'success', message: 'License generated' });
      }
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

            {isSaas && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Deliver to instance (optional)
                </label>
                <select
                  value={form.instanceId ?? ''}
                  onChange={e => setForm(p => ({ ...p, instanceId: e.target.value || undefined }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm
                             focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Don&apos;t auto-deliver</option>
                  {activeInstances.map(inst => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name} ({inst.environment})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  Publishes a <code>license.delivered</code> event to the chosen EA instance.
                </p>
              </div>
            )}
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
  const [instances, setInstances] = useState<Instance[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [deliverTarget, setDeliverTarget] = useState<string | null>(null);
  const [deliverInstance, setDeliverInstance] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [licResult, instResult] = await Promise.all([
        getLicenses(),
        listInstances().catch(() => ({ instances: [] as Instance[], total: 0 })),
      ]);
      setLicenses(licResult.licenses);
      setTotal(licResult.total);
      setInstances(instResult.instances);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load licenses');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const handle = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(handle);
  }, [toast]);

  async function handleRevoke(id: string) {
    setActionLoading(id);
    try {
      await revokeLicense(id);
      await load();
    } catch (err) {
      setToast({ kind: 'error', message: err instanceof Error ? err.message : 'Revoke failed' });
    }
    setActionLoading(null);
    setRevokeTarget(null);
  }

  async function handleDeliver(id: string, instanceId: string) {
    if (!instanceId) {
      setToast({ kind: 'error', message: 'Pick an instance first' });
      return;
    }
    setActionLoading(id);
    try {
      const result = await deliverLicense(id, instanceId);
      setToast({
        kind: 'success',
        message: `Delivered (${result.mode}, ${result.envelopeId.slice(0, 8)}…)`,
      });
      setDeliverTarget(null);
      setDeliverInstance('');
    } catch (err) {
      setToast({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Delivery failed',
      });
    } finally {
      setActionLoading(null);
    }
  }

  function downloadLicense(id: string) {
    window.open(`/api/licenses/${id}/download`, '_blank');
  }

  const activeInstances = instances.filter(i => i.status === 'active');

  return (
    <div className="p-8">
      {showGenerate && (
        <GenerateModal
          instances={instances}
          onClose={() => setShowGenerate(false)}
          onSuccess={load}
          onToast={setToast}
        />
      )}

      {toast && (
        <div className={clsx(
          'fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg border text-sm max-w-sm',
          toast.kind === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800',
        )}>
          <div className="flex items-start gap-2">
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => setToast(null)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
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
                    {!lic.isOnPrem && lic.tenantId && lic.status !== 'revoked' && (
                      deliverTarget === lic.id ? (
                        <div className="flex items-center gap-1">
                          <select
                            value={deliverInstance}
                            onChange={e => setDeliverInstance(e.target.value)}
                            className="px-2 py-1 border border-slate-200 rounded text-xs"
                            disabled={actionLoading === lic.id}
                          >
                            <option value="">Select instance…</option>
                            {activeInstances.map(inst => (
                              <option key={inst.id} value={inst.id}>
                                {inst.name} ({inst.environment})
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleDeliver(lic.id, deliverInstance)}
                            disabled={actionLoading === lic.id || !deliverInstance}
                            className="text-emerald-600 hover:text-emerald-800 disabled:opacity-50"
                            title="Confirm deliver"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setDeliverTarget(null); setDeliverInstance(''); }}
                            className="text-slate-400 hover:text-slate-600"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setDeliverTarget(lic.id); setDeliverInstance(''); }}
                          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                          title="Push license to tenant instance via event bus"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Deliver
                        </button>
                      )
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
