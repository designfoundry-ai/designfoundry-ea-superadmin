/**
 * DesignFoundry Super Admin Console — API Client
 *
 * Requests go to the rezonator backend at NEXT_PUBLIC_API_URL when set
 * (e.g. http://localhost:3001/api/v1). When unset, requests fall through to
 * the dev-only Next.js routes under /api/superadmin/* that query Postgres
 * directly — these are blocked by middleware in any env where
 * NEXT_PUBLIC_API_URL is configured. Endpoints live under /superadmin/* on
 * the backend. Auth: Bearer token with role=superadmin.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('superadmin_token')
    : null;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new ApiError('Access denied. Super admin role required.', 403, 'FORBIDDEN');
    }
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(body.message || 'API error', response.status, body.code);
  }

  return response.json();
}

// ─── Stats ────────────────────────────────────────────────────────────

export async function getOverviewStats() {
  return request<OverviewStats>('/superadmin/stats');
}

export interface OverviewStats {
  totalTenants: number;
  activeMRR: number;
  arr: number;
  totalUsers: number;
  churnRate: number;
  trialTenants: number;
  mrrHistory: Array<{ month: string; mrr: number }>;
  signupsHistory: Array<{ week: string; count: number }>;
  tenantStatusBreakdown: {
    active: number;
    trial: number;
    pastDue: number;
    canceled: number;
  };
  topTenantsByUsage: Array<{ tenantId: string; name: string; objects: number; diagrams: number }>;
  churnHistory: Array<{ month: string; rate: number }>;
}

// ─── Tenants ──────────────────────────────────────────────────────────

export async function getTenants(params?: TenantFilters) {
  const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return request<TenantList>(`/superadmin/tenants${qs}`);
}

export async function getTenant(id: string) {
  return request<Tenant>(`/superadmin/tenants/${id}`);
}

export async function suspendTenant(id: string) {
  return request<Tenant>(`/superadmin/tenants/${id}/suspend`, { method: 'POST' });
}

export async function activateTenant(id: string) {
  return request<Tenant>(`/superadmin/tenants/${id}/activate`, { method: 'POST' });
}

export async function updateTenant(id: string, data: Partial<Tenant>) {
  return request<Tenant>(`/superadmin/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteTenant(id: string) {
  return request<void>(`/superadmin/tenants/${id}`, { method: 'DELETE' });
}

export async function downloadTenantBackup(id: string): Promise<Blob> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('superadmin_token') : null;
  const response = await fetch(`${API_BASE}/superadmin/tenants/${id}/backup`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(body.message || 'Backup failed', response.status);
  }
  return response.blob();
}

export interface TenantFilters {
  plan?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface TenantList {
  tenants: Tenant[];
  total: number;
  page: number;
  limit: number;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'team' | 'professional' | 'enterprise';
  status: 'active' | 'trial' | 'suspended' | 'canceled';
  mrr: number;
  usersCount: number;
  objectsCount: number;
  diagramsCount: number;
  storageUsedMb: number;
  stripeCustomerId?: string;
  primaryEmail: string;
  createdAt: string;
  lastActiveAt: string;
  trialEndsAt?: string;
}

// ─── Users ────────────────────────────────────────────────────────────

export async function getAllUsers(params?: UserFilters) {
  const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return request<UserList>(`/superadmin/users${qs}`);
}

export async function getTenantUsers(tenantId: string) {
  return request<UserList>(`/superadmin/users?tenantId=${encodeURIComponent(tenantId)}`);
}

export async function disableUser(id: string) {
  return request<void>(`/superadmin/users/${id}/disable`, { method: 'POST' });
}

export async function enableUser(id: string) {
  return request<void>(`/superadmin/users/${id}/enable`, { method: 'POST' });
}

export interface UserFilters {
  tenantId?: string;
  role?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface UserList {
  users: User[];
  total: number;
  page: number;
  limit: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  tenantId: string;
  tenantName: string;
  role: string;
  status: 'active' | 'disabled';
  lastLoginAt?: string;
  createdAt: string;
}

// ─── Billing ──────────────────────────────────────────────────────────

export async function getBillingOverview() {
  return request<BillingOverview>('/superadmin/billing/overview');
}

export async function getFailedPayments() {
  return request<FailedPayment[]>('/superadmin/billing/failed-payments');
}

export async function retryPayment(customerId: string, invoiceId: string) {
  return request<void>('/superadmin/billing/retry-payment', {
    method: 'POST',
    body: JSON.stringify({ customerId, invoiceId }),
  });
}

export async function issueRefund(invoiceId: string, amount?: number) {
  return request<void>('/superadmin/billing/refund', {
    method: 'POST',
    body: JSON.stringify({ invoiceId, amount }),
  });
}

export interface BillingOverview {
  activeMRR: number;
  churnedMRR: number;
  netNewMRR: number;
  trialConversionRate: number;
  arpu: number;
  ltv: number;
  mrrHistory: Array<{ month: string; newBusiness: number; expansion: number; churned: number; netNew: number }>;
}

export interface FailedPayment {
  tenantId: string;
  tenantName: string;
  invoiceId: string;
  amount: number;
  currency: string;
  failedAt: string;
  retryCount: number;
  status: 'pending' | 'retrying' | 'failed';
}

// ─── Licenses ─────────────────────────────────────────────────────────

export async function getLicenses() {
  return request<LicenseList>('/licenses');
}

export async function getLicense(id: string) {
  return request<License>(`/licenses/${id}`);
}

export async function generateLicense(data: GenerateLicenseInput) {
  return request<License>('/licenses', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function extendLicense(id: string, months: number) {
  return request<License>(`/licenses/${id}/extend`, {
    method: 'PATCH',
    body: JSON.stringify({ months }),
  });
}

export async function revokeLicense(id: string) {
  return request<void>(`/licenses/${id}/revoke`, { method: 'POST' });
}

export interface GenerateLicenseInput {
  customerName: string;
  contactEmail: string;
  tenantSlug?: string;
  plan: string;
  maxUsers?: number;
  maxObjects?: number;
  features?: string[];
  addons?: string[];
  expiresAt?: string;
  deliveryModel?: 'saas' | 'on_prem' | 'dev';
}

export interface LicenseList {
  licenses: License[];
  total: number;
}

export interface License {
  id: string;
  tenantId: string;
  companyName: string;
  contactEmail: string;
  tier: 'free' | 'team' | 'professional' | 'enterprise';
  objectLimit: number;
  objectCount: number;
  userLimit: number;
  userCount: number;
  addOns: string[];
  validFrom: string;
  validUntil: string;
  status: 'active' | 'expiring' | 'expired' | 'revoked';
  hardwareBinding: {
    enabled: boolean;
    machineId?: string;
  };
  isOnPrem: boolean;
}

// ─── Activity ─────────────────────────────────────────────────────────

export async function getActivity(params?: ActivityFilters) {
  const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return request<ActivityList>(`/superadmin/activity${qs}`);
}

export async function exportActivity(params: ActivityFilters) {
  const qs = '?' + new URLSearchParams(params as Record<string, string>).toString();
  return request<Blob>(`/superadmin/activity/export${qs}`);
}

export interface ActivityFilters {
  tenantId?: string;
  eventType?: string;
  userId?: string;
  severity?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface ActivityList {
  events: ActivityEvent[];
  total: number;
  page: number;
  limit: number;
}

export type EventSeverity = 'INFO' | 'WARNING' | 'ERROR';

export interface ActivityEvent {
  id: string;
  tenantId?: string;
  tenantName?: string;
  userId?: string;
  userEmail?: string;
  eventType: string;
  severity: EventSeverity;
  details: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// ─── System ────────────────────────────────────────────────────────────

export async function getSystemHealth() {
  return request<SystemHealth>('/superadmin/system/health');
}

export async function getSystemErrors(params?: { page?: number; limit?: number }) {
  const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return request<ErrorList>(`/superadmin/system/errors${qs}`);
}

export interface SystemHealth {
  services: ServiceStatus[];
  metrics: SystemMetrics;
  deployment?: Deployment;
}

export interface ServiceStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  uptime: string;
  latencyMs: number;
}

export interface SystemMetrics {
  apiErrorRate: number;
  apiRequestsPerMin: number;
  dbConnections: { current: number; max: number };
  redisMemory: { used: number; max: number };
  diskUsage: { used: number; max: number };
}

export interface Deployment {
  version: string;
  service: string;
  commit: string;
  deployedAt: string;
  deployedBy: string;
  status: 'success' | 'failed';
}

export interface ErrorList {
  errors: SystemError[];
  total: number;
}

export interface SystemError {
  id: string;
  timestamp: string;
  endpoint: string;
  statusCode: number;
  message: string;
  userId?: string;
  tenantId?: string;
  stackTrace?: string;
}

// ─── Support ──────────────────────────────────────────────────────────

export async function getSupportTickets(params?: TicketFilters) {
  const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return request<TicketList>(`/superadmin/support/tickets${qs}`);
}

export async function updateTicket(id: string, data: Partial<SupportTicket>) {
  return request<SupportTicket>(`/superadmin/support/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function addTicketNote(id: string, note: string) {
  return request<void>(`/superadmin/support/tickets/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export interface TicketFilters {
  status?: string;
  priority?: string;
  assignedTo?: string;
  page?: number;
  limit?: number;
}

export interface TicketList {
  tickets: SupportTicket[];
  total: number;
}

export interface SupportTicket {
  id: string;
  tenantId: string;
  tenantName: string;
  reporterEmail: string;
  reporterName?: string;
  subject: string;
  body: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
  assignedTo?: string;
  assignedToName?: string;
  internalNotes?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

// ─── Settings ─────────────────────────────────────────────────────────

export async function getPlatformSettings() {
  return request<PlatformSettings>('/superadmin/settings');
}

export async function updatePlatformSettings(data: Partial<PlatformSettings>) {
  return request<PlatformSettings>('/superadmin/settings', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function getFeatureFlags() {
  return request<FeatureFlag[]>('/superadmin/settings/feature-flags');
}

export async function updateFeatureFlag(key: string, enabled: boolean) {
  return request<FeatureFlag>(`/superadmin/settings/feature-flags/${key}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export interface PlatformSettings {
  platformName: string;
  supportEmail: string;
  supportUrl: string;
  defaultTenantPlan: 'free' | 'team';
  registrationEnabled: boolean;
  trialEnabled: boolean;
}

export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  defaultEnabled: boolean;
}

// ─── Admin Audit Log ──────────────────────────────────────────────────

export async function getAdminAuditLog(params?: AdminAuditFilters) {
  const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return request<AdminAuditList>(`/superadmin/audit${qs}`);
}

export interface AdminAuditFilters {
  adminId?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface AdminAuditList {
  entries: AdminAuditEntry[];
  total: number;
}

export interface AdminAuditEntry {
  id: string;
  adminUserId: string;
  adminEmail: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: string;
  ipAddress: string;
  createdAt: string;
}
