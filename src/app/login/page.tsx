'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, AlertCircle } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
const LOGIN_URL = API_BASE
  ? `${API_BASE}/superadmin/login`
  : '/api/superadmin/login';

// In dev (no real backend) show the seeded credentials as the placeholder
// so a fresh contributor can sign in without grepping the codebase.
const IS_DEV_FALLBACK = !API_BASE;
const EMAIL_PLACEHOLDER = IS_DEV_FALLBACK
  ? 'super@designfoundry.app'
  : 'you@designfoundry.ai';
const PASSWORD_PLACEHOLDER = IS_DEV_FALLBACK ? 'superadmin123' : '••••••••';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Login failed');
      }

      if (data.user?.role !== 'superadmin') {
        throw new Error('Access denied. Super admin role required.');
      }

      localStorage.setItem('superadmin_token', data.token);
      localStorage.setItem('superadmin_user', JSON.stringify(data.user));
      router.push('/superadmin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          <div className="flex flex-col items-center gap-2 mb-8">
            <div className="w-12 h-12 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-slate-900">Super Admin</h1>
            <p className="text-sm text-slate-500 text-center">
              Sign in with your super admin credentials
            </p>
            {IS_DEV_FALLBACK && (
              <p className="text-xs text-amber-600 text-center mt-1">
                Dev mode — use{' '}
                <code className="font-mono">super@designfoundry.app</code> /{' '}
                <code className="font-mono">superadmin123</code>
              </p>
            )}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder={EMAIL_PLACEHOLDER}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder={PASSWORD_PLACEHOLDER}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-indigo-600 text-white rounded-lg text-sm font-medium
                         hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
