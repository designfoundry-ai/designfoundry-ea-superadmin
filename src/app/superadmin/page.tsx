'use client';

import { useEffect, useState } from 'react';
import {
  Building2,
  DollarSign,
  Users,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { getOverviewStats, type OverviewStats } from '@/lib/api';

const STATUS_COLORS = {
  active: '#10b981',
  trial: '#f59e0b',
  pastDue: '#ef4444',
  canceled: '#64748b',
};

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  trend?: { value: number; label: string };
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 mb-1">{label}</p>
          <p className="text-2xl font-semibold text-slate-900">{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center">
          <Icon className="w-5 h-5 text-indigo-600" />
        </div>
      </div>
      {trend && (
        <div className="mt-3 flex items-center gap-1 text-xs">
          <span className={trend.value >= 0 ? 'text-emerald-600' : 'text-red-600'}>
            {trend.value >= 0 ? '+' : ''}{trend.value}%
          </span>
          <span className="text-slate-400">{trend.label}</span>
        </div>
      )}
    </div>
  );
}

export default function OverviewPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOverviewStats()
      .then(data => { setStats(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-6 bg-slate-200 rounded w-48" />
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-slate-200 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="p-8 text-center text-red-600">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
        <p>{error || 'Failed to load dashboard'}</p>
      </div>
    );
  }

  const tenantBreakdown = [
    { name: 'Active',    value: stats.tenantStatusBreakdown.active,   fill: STATUS_COLORS.active },
    { name: 'Trial',     value: stats.tenantStatusBreakdown.trial,    fill: STATUS_COLORS.trial },
    { name: 'Past Due',  value: stats.tenantStatusBreakdown.pastDue,  fill: STATUS_COLORS.pastDue },
    { name: 'Cancelled', value: stats.tenantStatusBreakdown.canceled, fill: STATUS_COLORS.canceled },
  ];

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Platform Overview</h1>
        <p className="text-sm text-slate-500 mt-1">Last updated: {new Date().toLocaleTimeString()}</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          label="Total Tenants"
          value={stats.totalTenants.toLocaleString()}
          sub="active + trial"
          icon={Building2}
        />
        <KpiCard
          label="Active MRR"
          value={`$${stats.activeMRR.toLocaleString()}`}
          sub={`ARR: $${stats.arr.toLocaleString()}`}
          icon={DollarSign}
        />
        <KpiCard
          label="Total Users"
          value={stats.totalUsers.toLocaleString()}
          sub="across all tenants"
          icon={Users}
        />
        <KpiCard
          label="Churn Rate"
          value={`${stats.churnRate}%`}
          sub={`${stats.trialTenants} in trial`}
          icon={TrendingDown}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 col-span-2">
          <h3 className="text-sm font-medium text-slate-700 mb-4">MRR Growth</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={stats.mrrHistory}>
              <defs>
                <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={v => `$${v}`} />
              <Tooltip formatter={(v) => [`$${Number(v).toLocaleString()}`, 'MRR']} />
              <Area type="monotone" dataKey="mrr" stroke="#6366f1" fill="url(#mrrGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-700 mb-4">Tenant Status</h3>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={tenantBreakdown} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                   paddingAngle={3} dataKey="value">
                {tenantBreakdown.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1">
            {tenantBreakdown.map(({ name, value, fill }) => (
              <div key={name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: fill }} />
                  <span className="text-slate-600">{name}</span>
                </div>
                <span className="font-medium text-slate-900">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-700 mb-4">Weekly Signups</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.signupsHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <Tooltip />
              <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-700 mb-4">Churn Rate Trend</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={stats.churnHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} />
              <Tooltip formatter={(v) => [`${v}%`, 'Churn']} />
              <Line type="monotone" dataKey="rate" stroke="#ef4444" strokeWidth={2}
                    dot={{ r: 3, fill: '#ef4444' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <h3 className="text-sm font-medium text-slate-700">System Status</h3>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[
            { name: 'API Server', latency: '—', status: 'healthy' },
            { name: 'PostgreSQL', latency: '—', status: 'healthy' },
            { name: 'Redis',      latency: '—', status: 'healthy' },
            { name: 'SMTP',       latency: '—', status: 'healthy' },
          ].map(service => (
            <div key={service.name} className="p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium text-slate-700">{service.name}</span>
              </div>
              <p className="text-xs text-slate-400">{service.latency}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
