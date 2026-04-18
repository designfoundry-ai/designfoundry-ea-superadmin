'use client';

import { useEffect, useState } from 'react';
import { Settings, AlertTriangle, Check, Loader2 } from 'lucide-react';
import {
  getPlatformSettings, updatePlatformSettings,
  getFeatureFlags, updateFeatureFlag,
  type PlatformSettings, type FeatureFlag,
} from '@/lib/api';
import { clsx } from 'clsx';

function Toggle({ enabled, onChange, disabled }: { enabled: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={clsx(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50',
        enabled ? 'bg-indigo-600' : 'bg-slate-200',
      )}
    >
      <span className={clsx(
        'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
        enabled ? 'translate-x-4.5' : 'translate-x-0.5',
      )} />
    </button>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flagSaving, setFlagSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([getPlatformSettings(), getFeatureFlags()])
      .then(([s, f]) => { setSettings(s); setFlags(f); })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePlatformSettings(settings);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function toggleFlag(key: string, enabled: boolean) {
    setFlagSaving(key);
    try {
      const updated = await updateFeatureFlag(key, enabled);
      setFlags(prev => prev.map(f => f.key === key ? updated : f));
    } catch { /* ignore */ }
    setFlagSaving(null);
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="w-6 h-6 text-slate-700" />
        <h1 className="text-2xl font-semibold text-slate-900">Platform Settings</h1>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-6">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* General Settings */}
      {settings && (
        <form onSubmit={handleSave} className="bg-white rounded-xl border border-slate-200 p-6 mb-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">General</h2>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Platform Name</label>
            <input
              type="text"
              value={settings.platformName}
              onChange={e => setSettings(s => s ? { ...s, platformName: e.target.value } : s)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Support Email</label>
            <input
              type="email"
              value={settings.supportEmail}
              onChange={e => setSettings(s => s ? { ...s, supportEmail: e.target.value } : s)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Support URL</label>
            <input
              type="url"
              value={settings.supportUrl}
              onChange={e => setSettings(s => s ? { ...s, supportUrl: e.target.value } : s)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Default Tenant Plan</label>
            <select
              value={settings.defaultTenantPlan}
              onChange={e => setSettings(s => s ? { ...s, defaultTenantPlan: e.target.value as 'free' | 'team' } : s)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="free">Free</option>
              <option value="team">Team</option>
            </select>
          </div>

          <div className="flex items-center justify-between py-2 border-t border-slate-100">
            <div>
              <p className="text-sm font-medium text-slate-700">Registration Enabled</p>
              <p className="text-xs text-slate-400">Allow new tenants to sign up</p>
            </div>
            <Toggle
              enabled={settings.registrationEnabled}
              onChange={v => setSettings(s => s ? { ...s, registrationEnabled: v } : s)}
            />
          </div>

          <div className="flex items-center justify-between py-2 border-t border-slate-100">
            <div>
              <p className="text-sm font-medium text-slate-700">Trial Enabled</p>
              <p className="text-xs text-slate-400">New tenants start on a free trial</p>
            </div>
            <Toggle
              enabled={settings.trialEnabled}
              onChange={v => setSettings(s => s ? { ...s, trialEnabled: v } : s)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            {saved && (
              <span className="flex items-center gap-1 text-emerald-600 text-sm">
                <Check className="w-4 h-4" /> Saved
              </span>
            )}
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {/* Feature Flags */}
      {flags.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-700">Feature Flags</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {flags.map(flag => (
              <div key={flag.key} className="flex items-center justify-between px-6 py-4">
                <div>
                  <p className="text-sm font-medium text-slate-800 font-mono">{flag.key}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{flag.description}</p>
                  {!flag.enabled && flag.defaultEnabled && (
                    <p className="text-xs text-amber-500 mt-0.5">Default: on (currently overridden)</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {flagSaving === flag.key && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                  <Toggle
                    enabled={flag.enabled}
                    onChange={v => toggleFlag(flag.key, v)}
                    disabled={flagSaving === flag.key}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
