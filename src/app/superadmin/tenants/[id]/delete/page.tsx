'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, Download, Trash2, Loader2 } from 'lucide-react';
import { getTenant, deleteTenant, downloadTenantBackup, type Tenant } from '@/lib/api';

export default function DeleteTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [backupDone, setBackupDone] = useState(false);

  useEffect(() => {
    getTenant(id)
      .then(setTenant)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleBackup() {
    if (!tenant) return;
    setBackupLoading(true);
    setError(null);
    try {
      const blob = await downloadTenantBackup(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${tenant.slug}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed');
    } finally {
      setBackupLoading(false);
    }
  }

  async function handleDelete() {
    if (!tenant || confirm !== tenant.name) return;
    setDeleteLoading(true);
    setError(null);
    try {
      await deleteTenant(id);
      router.push('/superadmin/tenants');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deletion failed');
      setDeleteLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-8 text-center text-red-600">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
        <p>{error || 'Tenant not found'}</p>
      </div>
    );
  }

  const confirmed = confirm === tenant.name;

  return (
    <div className="p-8 max-w-xl">
      <Link href={`/superadmin/tenants/${id}`}
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to {tenant.name}
      </Link>

      <div className="bg-red-50 border border-red-200 rounded-xl p-6">
        <div className="flex items-start gap-3 mb-5">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <h1 className="text-lg font-semibold text-red-700">Delete Tenant</h1>
            <p className="text-sm text-red-600 mt-1">
              This will permanently delete <strong>{tenant.name}</strong> ({tenant.slug})
              and drop their database schema. This action <strong>cannot be undone</strong>.
            </p>
          </div>
        </div>

        {/* Stats summary */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Users', value: tenant.usersCount },
            { label: 'Objects', value: tenant.objectsCount },
            { label: 'Diagrams', value: tenant.diagramsCount },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-lg border border-red-200 p-3 text-center">
              <p className="text-xl font-semibold text-slate-800">{value.toLocaleString()}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          ))}
        </div>

        {/* Step 1: Backup */}
        <div className="bg-white rounded-lg border border-red-200 p-4 mb-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">
            Step 1 — Download backup <span className="text-slate-400 font-normal">(recommended)</span>
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            Export all tenant data as a CSV file before deletion.
          </p>
          <button
            onClick={handleBackup}
            disabled={backupLoading}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {backupLoading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />}
            {backupLoading ? 'Exporting…' : backupDone ? 'Download Again' : 'Download Backup'}
          </button>
          {backupDone && (
            <p className="text-xs text-emerald-600 mt-2">Backup downloaded.</p>
          )}
        </div>

        {/* Step 2: Confirm */}
        <div className="bg-white rounded-lg border border-red-200 p-4 mb-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">Step 2 — Confirm deletion</h3>
          <p className="text-xs text-slate-500 mb-3">
            Type <strong className="text-slate-700">{tenant.name}</strong> to confirm.
          </p>
          <input
            type="text"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder={tenant.name}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-100 border border-red-300 rounded-lg text-red-700 text-sm mb-4">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link href={`/superadmin/tenants/${id}`}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </Link>
          <button
            onClick={handleDelete}
            disabled={!confirmed || deleteLoading}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40"
          >
            {deleteLoading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Trash2 className="w-4 h-4" />}
            {deleteLoading ? 'Deleting…' : 'Delete Tenant'}
          </button>
        </div>
      </div>
    </div>
  );
}
