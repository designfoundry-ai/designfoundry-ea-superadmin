'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SuperAdminSidebar } from '@/components/layout/sidebar';
import { Shield } from 'lucide-react';

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('superadmin_token');
    const user = localStorage.getItem('superadmin_user');

    if (!token || !user) {
      void router.push('/login');
      return;
    }

    try {
      const userData = JSON.parse(user);
      if (userData.role !== 'superadmin') {
        void router.push('/login');
        return;
      }
    } catch {
      void router.push('/login');
      return;
    }

    // Defer setChecking to avoid calling setState synchronously in effect body
    const timeout = setTimeout(() => setChecking(false), 0);
    return () => clearTimeout(timeout);
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3 text-slate-500">
          <Shield className="w-5 h-5 animate-pulse" />
          <span className="text-sm">Verifying access…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-100">
      <SuperAdminSidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
