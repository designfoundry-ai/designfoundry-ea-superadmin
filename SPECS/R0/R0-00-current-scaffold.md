# R0-00 — Super Admin Console — Current Scaffold State

**Spec ID:** R0-00  
**Title:** Super Admin Console — Current Scaffold State (Retrospective)  
**Release:** R0  
**Priority:** P1  
**Status:** 🟡 Partial  
**Created:** 2026-04-18  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

This spec is a **retrospective capture** of what was built in the initial scaffold phase (2026-04-18 to 2026-04-25). It describes the current state of the `designfoundry-superadmin` application as it exists before formal implementation of the R1 features begins.

The application is a **standalone Next.js 15 app** deployed separately from the main Rezonator product. It currently has a complete frontend scaffold with routing, an API client library, authentication flow, sidebar navigation, and a dashboard page — but no backend API routes, no database tables, and no real pages for most features.

---

## 2. What Is Built

### 2.1 Frontend Scaffold

| Component | Path | Status | Notes |
|-----------|------|--------|-------|
| Next.js 15 app root | `src/app/` | ✅ | App Router, TypeScript, TailwindCSS |
| Superadmin layout (auth guard) | `src/app/superadmin/layout.tsx` | ✅ | Checks `localStorage` for token + `role=superadmin`; redirects to `/login` if missing |
| Overview dashboard page | `src/app/superadmin/page.tsx` | ✅ | KPI cards, MRR/ARR charts, tenant breakdown donut, system status banner — fetches from `NEXT_PUBLIC_API_URL/api/v1/superadmin/stats` |
| Login page | `src/app/login/page.tsx` | ✅ | Email/password form; stores `superadmin_token` + `superadmin_user` in `localStorage` |
| Login API route | `src/app/api/superadmin/login/route.ts` | ✅ | Proxies to backend `/auth/login`; falls back to dev credentials (`super@designfoundry.app` / `superadmin123`) when backend unreachable |
| Sidebar navigation | `src/components/layout/sidebar.tsx` | ✅ | All 10 nav items: Overview, Tenants, Billing, Licenses, Users, Activity, System, Support, Settings, Audit |
| API client library | `src/lib/api.ts` | ✅ | Full TypeScript interfaces + async methods for all API entities (stats, tenants, users, billing, licenses, activity, system, support, settings, audit) |
| Route directories | `src/app/superadmin/{tenants,billing,licenses,users,activity,system,support,settings,audit}/` | ✅ | All created; no page files inside yet |

### 2.2 API Client (`src/lib/api.ts`) — Defined Types

The following interface groups are fully typed:

```
OverviewStats        → totalTenants, activeMRR, arr, totalUsers, churnRate,
                        mrrHistory, signupsHistory, tenantStatusBreakdown,
                        topTenantsByUsage, churnHistory
Tenant / TenantList  → id, name, slug, plan, status, mrr, usersCount,
                        objectsCount, diagramsCount, storageUsedMb,
                        stripeCustomerId, primaryEmail, createdAt, lastActiveAt,
                        trialEndsAt
User / UserList      → id, name, email, tenantId, tenantName, role, status,
                        lastLoginAt, createdAt
BillingOverview      → activeMRR, churnedMRR, netNewMRR, trialConversionRate,
                        arpu, ltv, mrrHistory
FailedPayment        → tenantId, tenantName, invoiceId, amount, currency,
                        failedAt, retryCount, status
License / LicenseList → id, tenantId, companyName, tier, objectLimit,
                        objectCount, userLimit, userCount, addOns,
                        validFrom, validUntil, status, hardwareBinding, isOnPrem
ActivityEvent       → id, tenantId, tenantName, userId, userEmail, eventType,
                        severity, details, metadata, createdAt
SystemHealth         → services[], metrics (apiErrorRate, apiRequestsPerMin,
                        dbConnections, redisMemory, diskUsage), deployment
SupportTicket        → id, tenantId, tenantName, reporterEmail, reporterName,
                        subject, body, priority, status, assignedTo,
                        assignedToName, internalNotes, createdAt, updatedAt,
                        resolvedAt
PlatformSettings     → platformName, supportEmail, supportUrl,
                        defaultTenantPlan, registrationEnabled, trialEnabled
FeatureFlag          → key, description, enabled, defaultEnabled
AdminAuditEntry      → id, adminUserId, adminEmail, action, targetType,
                        targetId, details, ipAddress, createdAt
```

### 2.3 Authentication

- Dev mode: credentials `super@designfoundry.app` / `superadmin123` accepted when backend is unreachable
- Production: proxies login to `POST /api/v1/auth/login` on the main platform backend
- Token stored in `localStorage` as `superadmin_token`
- User object stored as `superadmin_user` (must have `role: 'superadmin'`)
- Auth guard on `SuperAdminLayout` redirects to `/login` if token/user missing or role ≠ `superadmin`

### 2.4 CI/CD

| File | Description |
|------|-------------|
| `Dockerfile` | Multi-stage build for production deployment |
| `.github/workflows/` (commit `e1df3df`) | CI/CD pipeline + GCP setup for production-only deploy |

---

## 3. What Is NOT Built

| Area | Status |
|------|--------|
| Backend NestJS API routes | ❌ Not started |
| Database migrations + tables | ❌ Not started |
| All superadmin pages (tenants, billing, licenses, etc.) | ❌ Not started — only route dirs exist |
| Real Stripe webhook handler | ❌ Not started |
| RSA license signing (KMS) | ❌ Not started |
| Google OAuth SSO | ❌ Not started (dev credentials fallback only) |
| Per-tenant content pack UI | ❌ Not started |
| Multi-instance management | ❌ Not started |
| AI models registry | ❌ Not started |
| Instance provisioning | ❌ Not started |

---

## 4. Architecture Decisions Made (Scaffold)

| Decision | Choice | Rationale |
|----------|--------|----------|
| Frontend framework | Next.js 15 App Router | Modern React 19, server components, API routes |
| Styling | TailwindCSS + Radix UI primitives | Fast iteration, accessible components |
| Charts | Recharts | Mature React chart library |
| API client | Manual `fetch` wrapper in `src/lib/api.ts` | No React Query / SWR in scaffold; easy to swap later |
| Auth storage | `localStorage` | Simple for scaffold; real app should use httpOnly cookies |
| Backend | NestJS (planned) | Matches main Rezonator stack |

---

## 5. Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Base URL for the main platform API (e.g. `http://localhost:3001`) |
| `NODE_ENV` | `development` / `production` — controls dev credential fallback |

---

## 6. Link to R1 Specs

This scaffold satisfies the frontend requirements of:
- **R1-01** (Overview Dashboard) — UI shell done, needs backend wiring
- **R1-02** (Tenant Management) — route dir exists, needs page + API
- **R1-03** (Billing) — route dir exists, needs page + API
- **R1-04** (Licenses) — route dir exists, needs page + API
- **R1-05** (Settings) — route dir exists, needs page + API
- **R1-06** (Observability) — route dirs exist, need pages + API

All other R1 specs are greenfield.
