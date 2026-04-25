'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  KeyRound,
  Users,
  Activity,
  Server,
  Network,
  LifeBuoy,
  Settings,
  ScrollText,
  ChevronRight,
  Shield,
} from 'lucide-react';
import { clsx } from 'clsx';

const navItems = [
  { href: '/superadmin', icon: LayoutDashboard, label: 'Overview', exact: true },
  { href: '/superadmin/instances', icon: Network, label: 'Instances' },
  { href: '/superadmin/tenants', icon: Building2, label: 'Tenants' },
  { href: '/superadmin/billing', icon: CreditCard, label: 'Billing' },
  { href: '/superadmin/licenses', icon: KeyRound, label: 'Licenses' },
  { href: '/superadmin/users', icon: Users, label: 'Users' },
  { href: '/superadmin/activity', icon: Activity, label: 'Activity Log' },
  { href: '/superadmin/system', icon: Server, label: 'System' },
  { href: '/superadmin/support', icon: LifeBuoy, label: 'Support' },
  { href: '/superadmin/settings', icon: Settings, label: 'Settings' },
  { href: '/superadmin/audit', icon: ScrollText, label: 'Audit Log' },
];

export function SuperAdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold text-sm">Super Admin</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ href, icon: Icon, label, exact }) => {
          const isActive = exact
            ? pathname === href
            : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {isActive && <ChevronRight className="w-3 h-3" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-slate-700">
        <div className="text-xs text-slate-400 px-3">
          DesignFoundry Admin
        </div>
      </div>
    </aside>
  );
}
