'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  commitInstanceKeyRotation,
  createInstance,
  deactivateInstance,
  listInstances,
  rotateInstanceKey,
  testInstance,
  type Instance,
  type InstanceCreated,
  type InstanceEnvironment,
  type InstanceTestResult,
  type RotateKeyResult,
} from '@/lib/api';

const ENV_BADGE: Record<InstanceEnvironment, string> = {
  production: 'bg-emerald-100 text-emerald-700',
  staging: 'bg-amber-100 text-amber-700',
  dev: 'bg-slate-100 text-slate-600',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  active: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-slate-100 text-slate-600',
  deactivated: 'bg-red-100 text-red-700',
};

const HEALTH_DOT: Record<string, string> = {
  healthy: 'bg-emerald-500',
  unhealthy: 'bg-red-500',
  unknown: 'bg-slate-300',
};

interface KeyDisclosure {
  apiKey: string;
  apiKeyWarning: string;
  context: 'created' | 'rotated';
  instanceId: string;
}

export default function InstancesPage() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [keyDisclosure, setKeyDisclosure] = useState<KeyDisclosure | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    Record<string, InstanceTestResult | undefined>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listInstances();
      setInstances(result.instances);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load instances');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() seeds the page; matches existing pattern in tenants/users pages
    load();
  }, [load]);

  async function handleCreate(input: {
    name: string;
    url: string;
    environment: InstanceEnvironment;
  }) {
    const created: InstanceCreated = await createInstance(input);
    setShowAdd(false);
    setKeyDisclosure({
      apiKey: created.apiKey,
      apiKeyWarning: created.apiKeyWarning,
      context: 'created',
      instanceId: created.id,
    });
    await load();
  }

  async function handleTest(id: string) {
    setActionId(id);
    try {
      const result = await testInstance(id);
      setTestResult((prev) => ({ ...prev, [id]: result }));
      await load();
    } finally {
      setActionId(null);
    }
  }

  async function handleRotate(id: string) {
    if (!confirm('Generate a new API key? Configure it on the instance and verify before committing.')) return;
    setActionId(id);
    try {
      const result: RotateKeyResult = await rotateInstanceKey(id);
      setKeyDisclosure({
        apiKey: result.apiKey,
        apiKeyWarning: result.apiKeyWarning,
        context: 'rotated',
        instanceId: id,
      });
      await load();
    } finally {
      setActionId(null);
    }
  }

  async function handleVerifyAndCommit(id: string) {
    setActionId(id);
    try {
      const verify = await testInstance(id, { pending: true });
      if (!verify.ok) {
        alert(`Verification failed: ${verify.error ?? 'unknown error'}`);
        return;
      }
      await commitInstanceKeyRotation(id);
      await load();
    } finally {
      setActionId(null);
    }
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Deactivate this instance? Its API key will be wiped and cannot be recovered.')) return;
    setActionId(id);
    try {
      await deactivateInstance(id);
      await load();
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Server className="w-6 h-6 text-slate-700" />
          <h1 className="text-2xl font-semibold text-slate-900">Instances</h1>
          <span className="text-sm text-slate-500">({instances.length})</span>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" /> Add Instance
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
              <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">URL</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Env</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Health</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Last Check</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading &&
              [...Array(3)].map((_, i) => (
                <tr key={i}>
                  {[...Array(7)].map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-slate-100 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && instances.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No instances registered. Click <strong>Add Instance</strong> to register one.
                </td>
              </tr>
            )}
            {!loading &&
              instances.map((inst) => {
                const health = inst.lastHealthStatus ?? 'unknown';
                const tr = testResult[inst.id];
                return (
                  <tr key={inst.id} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{inst.name}</div>
                      {inst.instanceVersion && (
                        <div className="text-xs text-slate-400">v{inst.instanceVersion}</div>
                      )}
                      {inst.hasPendingKey && (
                        <div className="text-xs text-amber-600 mt-1">
                          Pending key — verify and commit
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-mono text-xs break-all">
                      {inst.url}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                          ENV_BADGE[inst.environment],
                        )}
                      >
                        {inst.environment}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                          STATUS_BADGE[inst.status] ?? 'bg-slate-100 text-slate-600',
                        )}
                      >
                        {inst.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={clsx('w-2 h-2 rounded-full', HEALTH_DOT[health])}
                        />
                        <span className="capitalize text-slate-600">{health}</span>
                      </div>
                      {tr && tr.ok && tr.latencyMs !== undefined && (
                        <div className="text-xs text-slate-400 mt-1">{tr.latencyMs}ms</div>
                      )}
                      {tr && !tr.ok && tr.error && (
                        <div className="text-xs text-red-600 mt-1">{tr.error}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {inst.lastHealthCheck
                        ? new Date(inst.lastHealthCheck).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => handleTest(inst.id)}
                          disabled={actionId === inst.id}
                          className="text-indigo-600 hover:text-indigo-800 font-medium text-xs disabled:opacity-50"
                        >
                          Test
                        </button>
                        {inst.hasPendingKey && (
                          <button
                            onClick={() => handleVerifyAndCommit(inst.id)}
                            disabled={actionId === inst.id}
                            className="text-emerald-600 hover:text-emerald-800 font-medium text-xs disabled:opacity-50"
                          >
                            Verify &amp; Commit
                          </button>
                        )}
                        <button
                          onClick={() => handleRotate(inst.id)}
                          disabled={actionId === inst.id}
                          className="text-amber-600 hover:text-amber-800 font-medium text-xs disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" /> Rotate
                        </button>
                        <button
                          onClick={() => handleDeactivate(inst.id)}
                          disabled={actionId === inst.id}
                          className="text-red-600 hover:text-red-800 font-medium text-xs disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Deactivate
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddInstanceModal
          onCancel={() => setShowAdd(false)}
          onCreate={handleCreate}
        />
      )}

      {keyDisclosure && (
        <KeyDisclosureModal
          disclosure={keyDisclosure}
          onClose={() => setKeyDisclosure(null)}
        />
      )}
    </div>
  );
}

function AddInstanceModal({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (input: {
    name: string;
    url: string;
    environment: InstanceEnvironment;
  }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [environment, setEnvironment] = useState<InstanceEnvironment>('production');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      await onCreate({ name: name.trim(), url: url.trim(), environment });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed to create instance');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Add Instance</h2>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme EU Production"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Instance URL</label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://acme.designfoundry.ai"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              The base URL of the EA instance. The superadmin will call <code>/api/v1/platform/health</code> beneath it.
            </p>
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Environment</label>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as InstanceEnvironment)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="dev">Dev</option>
            </select>
          </div>
          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              {err}
            </div>
          )}
        </div>
        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create & Generate Key'}
          </button>
        </div>
      </form>
    </div>
  );
}

function KeyDisclosureModal({
  disclosure,
  onClose,
}: {
  disclosure: KeyDisclosure;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(disclosure.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // copy failed — user can still select manually
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-slate-900">
              {disclosure.context === 'rotated' ? 'New API Key' : 'API Key Generated'}
            </h2>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-600">{disclosure.apiKeyWarning}</p>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-mono break-all">
              {disclosure.apiKey}
            </code>
            <button
              onClick={handleCopy}
              className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 inline-flex items-center gap-1"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Set <code>PLATFORM_ADMIN_API_KEY=&lt;key&gt;</code> on the EA instance and restart its service.
          </p>
        </div>
        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700"
          >
            I have copied it
          </button>
        </div>
      </div>
    </div>
  );
}
