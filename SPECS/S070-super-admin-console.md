# S070 — Super Admin Console

**Spec ID:** S070  
**Title:** Super Admin Console — Standalone `designfoundry-superadmin` Application  
**Release:** R1  
**Priority:** P1  
**Status:** Draft  
**Created:** 2026-04-18  
**Updated:** 2026-04-18  
**Spec Owner:** TBD  
**Backlog Ref:** P1-70

---

## 1. Feature Overview

The super admin console is a **dedicated, standalone application** (`designfoundry-superadmin`) deployed separately from the main Rezonator product. It is the operations hub for the platform team: tenant management, user oversight, license generation and signing, Stripe billing management, system health monitoring, feature flags, and audit logs.

**Why a separate application?**

| Reason | Detail |
|---|---|
| **Key isolation** | RSA private key (signs licenses) never lives in the main app — admin compromise cannot forge licenses |
| **Always-on for webhooks** | Stripe webhooks require a reliably available endpoint; this process must not share restart cycles with the main app |
| **Deployment independence** | Admin app can be updated without rolling the main product |
| **Blast radius** | A crash in the admin app does not affect any tenant |

```
┌──────────────────────────────────────────────────────────────────────┐
│  SUPER ADMIN CONSOLE  (designfoundry-superadmin)                     │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Overview  │  │ Tenants  │  │  Billing │  │ Licenses │          │
│  │ Dashboard │  │          │  │          │  │(Generator)│          │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  Users   │  │ Activity │  │  System  │  │ Settings │          │
│  │  (all)   │  │   Log    │  │  Health  │  │ + Flags  │          │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
└──────────────────────────────────────────────────────────────────────┘
```

**Access:** Deployed on a separate GCP project (`df-superadmin-prod`). **Restricted to `@designfoundry.ai` domain users only.** Google Workspace OIDC SSO — no VPN, no IP allowlist, no password-based login. Admins are invited by existing admins (no public signup).

---

## 2. Repo Naming Convention

| Repo | Purpose |
|---|---|
| `designfoundry-app` | NestJS backend for the main Rezonator product |
| `designfoundry-web` | Next.js frontend for the main Rezonator product |
| `designfoundry-superadmin` | This spec — standalone admin console (full-stack, single repo) |

---

## 3. Architecture

### 3.1 Repository Structure

```
designfoundry-superadmin/
├── backend/                     # NestJS (admin-specific API)
│   └── src/
│       ├── tenants/
│       ├── users/
│       ├── billing/             # Stripe webhook handler + billing views
│       ├── licenses/            # License generator (RSA signing via KMS)
│       ├── activity/
│       ├── system/
│       ├── settings/
│       └── audit/
├── frontend/                    # Next.js 15 admin UI
│   └── app/
│       ├── (dashboard)/
│       ├── tenants/
│       ├── billing/
│       ├── licenses/
│       ├── users/
│       ├── activity/
│       ├── system/
│       ├── settings/
│       └── audit/
├── shared/                      # Types shared between backend + frontend
│   └── license-types.ts
├── keys/                        # Dev RSA key pair (gitignored; see §3.4)
│   ├── .gitkeep
│   └── README.md
└── docker-compose.yml           # Local dev stack
```

### 3.2 Deployment Topology

```
┌────────────────────────────────────────────────────────────────────┐
│  GCP Project: df-superadmin-prod                                   │
│                                                                    │
│  Cloud Run: designfoundry-superadmin                               │
│    min-instances: 1  ← required for reliable Stripe webhooks       │
│    │                                                               │
│    ├── reads secrets from: GCP Secret Manager                      │
│    │     STRIPE_SECRET_KEY, ADMIN_JWT_SECRET                       │
│    │                                                               │
│    └── signs licenses via: GCP Cloud KMS (HSM key ring)            │
│          private key never leaves KMS                              │
└───────────────────────────────────┬───────────────────────────────┘
                                    │ reads/writes
                                    ▼
┌────────────────────────────────────────────────────────────────────┐
│  Shared PostgreSQL                                                 │
│  Tables owned by main app: tenants, users                          │
│  Tables owned by admin app: admin_audit_log,                       │
│    platform_activity_log, support_tickets, licenses,               │
│    revoked_licenses, platform_settings                             │
└───────────────────────────────────┬───────────────────────────────┘
                                    │ admin writes tenants.license_blob
                                    ▼
┌────────────────────────────────────────────────────────────────────┐
│  GCP Project: df-prod (main Rezonator)                             │
│  TenantMiddleware reads tenants.license_blob on every request      │
│  → verifies RSA signature → extracts features/limits → enforces   │
└────────────────────────────────────────────────────────────────────┘
```

### 3.3 Database Access

**Default for R1 — Option A: Shared DB, separate tables**

- Admin app connects to the same PostgreSQL instance as the main app
- Reads `tenants` and `users` tables (main app owns these)
- Owns its own tables: `licenses`, `admin_audit_log`, `platform_activity_log`, `support_tickets`, `revoked_licenses`, `platform_settings`
- Adds columns to shared tables via migration: `tenants.license_blob`, `tenants.license_updated`

**Future — Option B: Dedicated admin DB**

- Admin DB mirrors tenant/user data via CDC
- Stronger isolation; more complex to keep in sync
- Preferred for large-scale multi-region deployments

### 3.4 RSA Key Management

| Environment | Private Key | Public Key |
|---|---|---|
| **Production** | GCP Cloud KMS (HSM-backed) | Env var `LICENSE_PUBLIC_KEY` in main app |
| **Staging** | GCP Secret Manager (PEM string) | Env var in staging deployment |
| **Development** | `./keys/private.pem` (auto-generated, gitignored) | `./keys/public.pem` (gitignored) |

Key rotation is supported via `kid` (Key ID) header in license JWTs — see S073 §8.

### 3.5 Stripe Webhook Handler (Always-On)

The admin app is the **sole** receiver of Stripe webhooks:

```
Stripe → POST /webhooks/stripe → designfoundry-superadmin backend
                                          │
                               verify webhook signature (STRIPE_WEBHOOK_SECRET)
                                          │
                               generate/update signed license JWT
                                          │
                               write license_blob to tenants.license_blob
                                          │
                               main app reads license on next request
```

Cloud Run `min-instances: 1` ensures the webhook endpoint is always available.

---

## 4. Goals

- [ ] **Overview Dashboard** — MRR, ARR, active tenants, signups (7d/30d), churn rate, trial conversion
- [ ] **Tenant Management** — list, filter, view, edit, suspend/activate, delete
- [ ] **Per-Tenant Statistics** — object count, user count, diagram count, storage, last active
- [ ] **Billing & Subscriptions** — Stripe customer view, subscription status, invoices, upgrade/downgrade, refunds
- [ ] **License Management** — generate signed licenses, list all licenses, revoke/extend, download `.lic` files
- [ ] **Platform-Wide Activity Log** — all significant events across all tenants
- [ ] **System Health** — service uptime, error rate, DB connections, Redis status, API latency
- [ ] **Platform Settings** — email sender config, support email, platform branding, feature flags
- [ ] **Admin Audit Log** — every super-admin action: who, what, when, from where

---

## 5. Non-Goals

- Customer-facing support portal (separate feature)
- Two-way messaging with tenants
- Direct database editing (all operations via API)
- Real-time WebSocket feeds (polling acceptable for admin UI)
- Multi-tier admin roles (all super-admins are peers in v1)

---

## 6. Navigation Structure

```
/ (root of admin app)
├── /                        → Overview Dashboard
├── /tenants                 → Tenant List
│   └── /tenants/:id         → Tenant Detail
│       ├── /tenants/:id/users
│       ├── /tenants/:id/billing
│       ├── /tenants/:id/activity
│       └── /tenants/:id/settings
├── /billing                 → Billing Overview (Stripe)
│   └── /billing/customers/:id
├── /licenses                → License Manager
│   ├── /licenses/new        → Generate License
│   └── /licenses/:id        → License Detail
├── /users                   → All Users (cross-tenant)
├── /activity                → Platform Activity Log
├── /system                  → System Health
├── /settings                → Platform Settings + Feature Flags
└── /audit                   → Admin Audit Log
```

---

## 7. Overview Dashboard (`/`)

Real-time KPI view of platform health and business metrics.

### 7.1 KPI Cards (top row)

| KPI | Source |
|---|---|
| Total Tenants (active) | DB count |
| Active MRR | Stripe subscription amounts |
| ARR | MRR × 12 |
| Total Users | DB count |
| Churn Rate (monthly) | Stripe |
| Trial Tenants | DB + Stripe trial status |

### 7.2 Charts

| Chart | Type | Data |
|---|---|---|
| MRR Growth | Line | Last 12 months |
| New Signups | Bar | Per week, last 12 weeks |
| Tenant Status | Donut | Active / Trial / Past Due / Cancelled |
| Top 10 by Usage | Horizontal bar | Objects + diagrams combined |
| Churn Trend | Line | Monthly churn % over 12 months |

### 7.3 Recent Activity Feed

Last 20 platform events: new tenant signups, subscription changes, license events, suspensions.

### 7.4 System Status Banner

```
┌────────────────────────────────────────────────────────────────┐
│ 🟢 All systems operational   DB: 23ms   Redis: 1ms   API: 94ms │
└────────────────────────────────────────────────────────────────┘
```

---

## 8. Tenant Management (`/tenants`)

### 8.1 Tenant List

Sortable, filterable table:

| Column | Description |
|---|---|
| Tenant Name | Organization name |
| Plan | Free / Team / Professional / Enterprise |
| Status | Active / Trial / Suspended / Cancelled |
| Users | User count |
| Objects | Architecture object count |
| MRR | Monthly revenue (Stripe) |
| Created | Signup date |
| Last Active | Last user activity |
| Actions | View / Suspend / Delete |

Filters: plan, status, date range, name search. Bulk actions: Suspend selected, Export CSV.

### 8.2 Tenant Detail (`/tenants/:id`)

Header with: org name, admin email, creation date, plan, status, MRR.

**Tabs:** Overview · Users · Billing · Activity · Settings

#### Overview Tab
Usage stat cards (objects, diagrams, users, storage), 30-day usage trend chart, quick actions (send email, open as admin, suspend, upgrade plan).

#### Users Tab
All users in tenant: name, email, role, last login. Per-user actions: change role, force password reset, revoke sessions, delete.

#### Billing Tab
Current Stripe subscription card, recent invoices, payment method (masked), actions: change plan, issue refund, cancel subscription, retry failed payment.

#### Activity Tab
All events for this tenant (same schema as platform activity log, filtered by tenant_id).

#### Settings Tab
Tenant name and slug, primary contact email, tenant timezone, suspend/activate toggle. Danger zone: delete tenant (requires typing tenant name to confirm).

---

## 9. Billing & Subscriptions (`/billing`)

### 9.1 Billing Overview

Active MRR, Churned MRR, Net New MRR, Trial Conversion Rate, ARPU, LTV.

### 9.2 Revenue Chart

Line chart with segments: New Business / Expansion / Churned / Net New MRR. Period: 3M / 6M / 12M / All time.

### 9.3 Failed Payments Queue

Tenants with failed payments and dunning status: tenant, amount, failed date, retry count. Actions: Retry Now / Contact / Waive.

### 9.4 Stripe Customer Link

Opens Stripe Dashboard for the customer: `https://dashboard.stripe.com/customers/{stripeCustomerId}`.

---

## 10. License Management (`/licenses`)

This is the **license generator** — it creates signed license JWTs per S073. All license formats are defined in S073.

### 10.1 License List

All licenses (SaaS auto-generated + on-prem manual):

| Customer | Plan | Add-Ons | Issued | Expires | Status | Actions |
|---|---|---|---|---|---|---|
| Acme Corp (SaaS) | Professional | AI | Jan 2026 | Jan 2027 | ● Active | View / Revoke |
| Globex (On-Prem) | Enterprise | All | Mar 2026 | Mar 2027 | ● Active | View / Revoke / Download |
| Initech (On-Prem) | Team | — | Sep 2025 | Apr 2026 | ⚠️ Expiring | Extend / Contact |

Filters: delivery model, plan, status, expiry range.

### 10.2 Generate License (`/licenses/new`)

For on-premises customers. Form inputs:

- Customer name, contact email, tenant slug
- Plan (Free / Team / Professional / Enterprise)
- Max users, max objects (pre-filled from plan defaults, overridable)
- Feature list (auto-populated from plan, overridable)
- Add-ons (multi-select)
- Expiry date
- License type: annual / perpetual / custom

On submit:
1. Backend calls GCP Cloud KMS to sign the license JWT (RS256)
2. Stores record in `licenses` table
3. Offers `.lic` file download (base64 JWT in PEM wrapper)
4. Optionally sends `.lic` file by email to the contact address

### 10.3 License Detail (`/licenses/:id`)

- License ID, customer, plan, add-ons, delivery model
- Issue and expiry dates
- Key ID used for signing
- Decoded license payload (read-only display)
- Actions: Extend / Revoke / Add add-on / Remove add-on / Download / Send by email

### 10.4 License Revocation

Revocation writes the `license_id` to `revoked_licenses`. The main app checks this table on license validation (cached with 60s TTL). For offline on-prem, revocation only takes effect on license renewal.

### 10.5 License Extension

Extend generates a new JWT with updated `exp`, re-signs it, updates `licenses` table, and offers the new `.lic` file for download. The previous license JWT is automatically invalidated (replaced in `tenants.license_blob` for SaaS; customer re-uploads for on-prem).

---

## 11. All Users (`/users`)

Cross-tenant user management:

| Name | Email | Tenant | Role | Status | Last Login | Actions |
|---|---|---|---|---|---|---|
| John Doe | john@acme.com | Acme Corp | Admin | Active | 2h ago | View / Edit / Disable |

Filters: tenant, role, status, date range. Bulk actions: Export CSV, Bulk disable, Bulk delete (confirmation required).

---

## 12. Platform Activity Log (`/activity`)

Comprehensive event log:

| Timestamp | Tenant | User | Event Type | Details | Severity |
|---|---|---|---|---|---|
| Apr 18 10:23 | Acme Corp | john@acme.com | OBJECT_CREATED | "API Gateway" | INFO |
| Apr 18 09:55 | Globex | — | SUBSCRIPTION_UPGRADED | Team → Professional | INFO |
| Apr 18 08:12 | Initech | — | LICENSE_EXPIRING | 14 days until expiry | WARNING |
| Apr 17 18:30 | — | — | BILLING_PAYMENT_FAILED | Acme Corp: $299 declined | ERROR |

### Event Types

```
AUTH:        LOGIN, LOGOUT, PASSWORD_RESET_REQUEST, PASSWORD_CHANGED, SESSION_REVOKED
OBJECTS:     OBJECT_CREATED, OBJECT_UPDATED, OBJECT_DELETED, OBJECT_IMPORTED
DIAGRAMS:    DIAGRAM_CREATED, DIAGRAM_UPDATED, DIAGRAM_DELETED, DIAGRAM_EXPORTED
BILLING:     SUBSCRIPTION_CREATED, SUBSCRIPTION_UPGRADED, SUBSCRIPTION_DOWNGRADED,
             SUBSCRIPTION_CANCELLED, TRIAL_STARTED, TRIAL_ENDED, PAYMENT_FAILED,
             PAYMENT_SUCCEEDED, INVOICE_CREATED, REFUND_ISSUED
LICENSE:     LICENSE_GENERATED, LICENSE_INSTALLED, LICENSE_EXPIRING, LICENSE_EXPIRED,
             LICENSE_REVOKED, LICENSE_EXTENDED, LICENSE_UPGRADED
ADMIN:       ADMIN_LOGIN, ADMIN_ACTION, TENANT_SUSPENDED, TENANT_ACTIVATED,
             TENANT_DELETED, USER_GLOBAL_DISABLE
SYSTEM:      IMPORT_COMPLETED, IMPORT_FAILED
```

Filters: tenant (multi-select), event type, user, severity, date range. Export: CSV.

---

## 13. System Health (`/system`)

### 13.1 Service Status

| Service | Status | Uptime | Latency | Actions |
|---|---|---|---|---|
| API Server | 🟢 Healthy | 14d 7h | 94ms avg | — |
| PostgreSQL | 🟢 Healthy | 14d 7h | 23ms avg | — |
| Redis | 🟢 Healthy | 14d 7h | 1ms avg | — |
| SMTP | 🟢 Healthy | — | — | Test |
| Admin App (this) | 🟢 Healthy | 14d 7h | — | — |

The system health page monitors **both** the admin app and the main Rezonator app. The admin app polls `GET /api/v1/health` on the main app.

### 13.2 Metrics

| Metric | Current | 24h Avg | 7d Avg |
|---|---|---|---|
| API Error Rate | 0.2% | 0.18% | 0.21% |
| API Requests/min | 1,243 | 1,189 | 1,102 |
| DB Connections | 24 / 100 | 22 | 20 |
| Redis Memory | 42MB / 256MB | 41MB | 40MB |
| Disk Usage | 128GB / 500GB | — | — |

### 13.3 Error Log

Last 50 errors: timestamp, endpoint, HTTP status, error message, user/tenant, stack trace link.

### 13.4 Recent Deployments

| Time | Version | Service | Commit | Status |
|---|---|---|---|---|
| Apr 18 06:00 | v1.4.2 | Backend | abc1234 | 🟢 |
| Apr 18 06:00 | v1.4.2 | Frontend | abc1234 | 🟢 |

---

## 14. Platform Settings (`/settings`)

### 14.1 General

Platform name, logo (for emails/PDFs), support email, support URL, default plan for new signups.

### 14.2 Email Templates

Editable transactional templates: welcome, license expiry reminder (30d/14d/7d), password reset, payment failed, trial ending, custom.

### 14.3 Feature Flags

Enable/disable features globally. Flag changes are written to `platform_settings` table. Main app reads with 60s cache TTL.

| Flag | Description | Default |
|---|---|---|
| `REGISTRATION_ENABLED` | Allow new tenant signups | ON |
| `TRIAL_ENABLED` | Allow 14-day trial for new tenants | ON |
| `EXPORT_VSDX_ENABLED` | VSDX export via microservice | ON |
| `SOCIAL_LOGIN_ENABLED` | Google/GitHub OAuth | OFF |
| `ON_PREM_ENABLED` | Allow on-prem license uploads | ON |
| `AI_FEATURES_ENABLED` | Global AI feature gate | OFF |

### 14.4 Danger Zone

- **Read-only mode** — entire platform read-only (for maintenance)
- **Force logout all users** — revoke all sessions immediately
- **Reset platform** — wipe all data (requires super_admin + email confirmation code)

---

## 15. Admin Audit Log (`/audit`)

Every action taken by a super-admin in this console:

| Timestamp | Admin | Action | Target | Details | IP |
|---|---|---|---|---|---|
| Apr 18 10:30 | admin@df.ai | TENANT_SUSPENDED | Acme Corp | — | 1.2.3.4 |
| Apr 18 09:15 | admin@df.ai | LICENSE_EXTENDED | Globex Corp | +12 months | 1.2.3.4 |
| Apr 18 08:00 | admin@df.ai | FEATURE_FLAG_CHANGED | AI_FEATURES_ENABLED | false→true | 1.2.3.4 |

Separate from the platform activity log — tracks admin-initiated actions only.

---

## 16. API Contract — Admin App ↔ Main App

The two applications communicate exclusively via the shared PostgreSQL database. No direct HTTP calls between them (except the health probe described in §13.1).

### 16.1 License Delivery

```
Admin App writes:                     Main App reads:
─────────────────                     ────────────────
tenants.license_blob TEXT             TenantMiddleware reads this column
  = base64(signedJWT)                 → verifies RSA signature (public key)
tenants.license_updated TIMESTAMPTZ   → extracts features/limits
                                      → attaches LicenseContext to request
```

### 16.2 Feature Flags

```
Admin App writes:                     Main App reads:
─────────────────                     ────────────────
platform_settings table               FeatureFlagService reads on startup
  key/value pairs                     + polls every 60s
```

### 16.3 Tenant Status

```
Admin App writes:                     Main App reads:
─────────────────                     ────────────────
tenants.status = 'suspended'          TenantMiddleware checks status
                                      → returns 403 if suspended
```

### 16.4 License Revocation

```
Admin App writes:                     Main App reads:
─────────────────                     ────────────────
revoked_licenses table                LicenseService.isRevoked(jti)
  license_id, revoked_at, reason      → checked during license validation
```

### 16.5 Why No Direct HTTP

- Avoids service coupling and circular dependency risk
- No auth token sharing between services
- Database is the durable, auditable integration layer
- Admin app can be restarted without the main app noticing (and vice versa)

---

## 17. Local Development

### 17.1 Port Convention

| Service | Port |
|---|---|
| `designfoundry-web` (frontend) | 3000 |
| `designfoundry-app` (backend) | 3001 |
| `designfoundry-superadmin` | 3002 |

### 17.2 Dev Setup

```bash
cd designfoundry-superadmin

# One-time: generate RSA key pair for local license signing
npm run keys:generate
# Creates ./keys/private.pem and ./keys/public.pem (both gitignored)

# Copy public key to main app .env.local:
# LICENSE_PUBLIC_KEY_DEV=<cat ./keys/public.pem>

# Start admin app
npm run dev
# Backend: http://localhost:3002/api
# Frontend: http://localhost:3002

# First-time setup: authenticate with Google SSO
# Visit http://localhost:3002 → redirects to Google OAuth
# After first admin is seeded in DB (see §18.0), subsequent admins use invitation flow
```

### 17.3 Dev Environment Variables

```
# .env.local (designfoundry-superadmin)
PORT=3002
DATABASE_URL=postgresql://design_foundry:password@localhost:5432/design_foundry

# Google OAuth (use dev credentials from Google Cloud console)
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
OAUTH_REDIRECT_URI=http://localhost:3002/api/auth/callback/google
ALLOWED_DOMAIN=designfoundry.ai

# License signing
RSA_PRIVATE_KEY_PATH=./keys/private.pem
RSA_PUBLIC_KEY_PATH=./keys/public.pem
LICENSE_KEY_ID=dev-2026-01

# Stripe (use test keys)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Admin session
ADMIN_JWT_SECRET=dev-secret-change-in-prod
```

---

### 21.6 Google Workspace OIDC Setup

The admin app uses the **same Google OAuth 2.0 app** as the main Rezonator product (S010). No separate OAuth app needed.

1. In Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs
2. Add `https://superadmin.designfoundry.ai/api/auth/callback/google` as an authorized redirect URI
3. Copy `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to GCP Secret Manager under `df-superadmin-prod`
4. In the admin app's `.env.local` / Secret Manager:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   OAUTH_REDIRECT_URI=https://superadmin.designfoundry.ai/api/auth/callback/google
   ALLOWED_DOMAIN=designfoundry.ai
   ```
5. The OIDC callback validates `email.endsWith('@designfoundry.ai')` — non-matching emails get HTTP 403.

### 21.7 Invitation System

Admins invite colleagues by email. Only `@designfoundry.ai` addresses accepted.

```sql
CREATE TABLE admin_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) NOT NULL,   -- must end with @designfoundry.ai
  token       VARCHAR(64) NOT NULL UNIQUE,
  invited_by  UUID NOT NULL REFERENCES admin_users(id),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Invitation flow:
1. Admin A creates invitation → `admin_invitations` row + sends email
2. Invite link: `https://superadmin.designfoundry.ai/invitation/:token`
3. Invite opens → redirects to Google OAuth → sign in with `@designfoundry.ai`
4. Callback creates `admin_users` row with `google_sub` from OAuth token

## 18. Migration Plan — From Monorepo to Separate Repo

### 18.0 Pre-requisites Before First Deployment

1. **Google OAuth redirect URI:** Add `https://superadmin.designfoundry.ai/api/auth/callback/google` to the existing Google OAuth 2.0 Client (same app used by main Rezonator product — S010). No new OAuth app needed.
2. **Secret Manager:** Add `df-superadmin-prod` secrets:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `STRIPE_SECRET_KEY`
   - `ADMIN_JWT_SECRET`
3. **Seed first admin** (no self-service until at least one admin exists):
   ```sql
   INSERT INTO admin_users (id, email, google_sub, name, role, status, created_by)
   VALUES ('<uuid>', 'you@designfoundry.ai', '<google-sub>', 'Your Name', 'admin', 'active', '<self>');
   ```
   The `google_sub` comes from the Google OAuth ID token for the first admin's Google account.
4. Create `df-superadmin-prod` GCP project with Cloud Run
5. Add DNS record: `superadmin.designfoundry.ai`

### 18.1 Code That Moves to `designfoundry-superadmin`

| Current Location (main monorepo) | Destination | Notes |
|---|---|---|
| `backend/superadmin/**` | `designfoundry-superadmin/backend/src/` | All superadmin API controllers |
| `src/app/superadmin/**` | `designfoundry-superadmin/frontend/app/` | All superadmin UI pages |
| Stripe webhook controller | `designfoundry-superadmin/backend/src/billing/` | No longer in main app |
| RSA license signing code | `designfoundry-superadmin/backend/src/licenses/` | Signing capability moves with private key |
| `super_admin` user seeder | `designfoundry-superadmin/` | Admin users managed in admin app |

### 18.2 Code That Stays in Main App

| What | Why |
|---|---|
| `TenantMiddleware` (license validation) | Runs on every request in main app |
| `@RequiresFeature()` decorator + service | Belongs in main app |
| `FeatureFlagService` (reads platform_settings) | Belongs in main app |
| `tenants` entity + `users` entity | Shared tables; admin app reads/writes via DB |
| `GET /api/v1/health` endpoint | Admin polls this for system health |
| RSA public key (as env var) | Used to verify signatures; no private key needed |

### 18.3 Migration Steps (Ordered)

1. Create `designfoundry-superadmin` repo from NestJS + Next.js template
2. Copy `backend/superadmin/` and `src/app/superadmin/` into new repo structure
3. Add `license_blob` and `license_updated` columns to `tenants` table (migration)
4. Add `revoked_licenses`, `platform_settings`, `licenses`, `admin_audit_log` tables
5. Move Stripe webhook controller and `STRIPE_SECRET_KEY` to admin app
6. Move RSA signing code to admin app; remove private key from main app
7. Main app reads license from `tenants.license_blob` instead of generating locally
8. Remove `/api/v1/superadmin/*` routes from main app
9. Remove `super_admin` role check from main app JWT guard (admin app has its own JWT)
10. Verify: main app still works with no admin app running (graceful license fallback)
11. Deploy admin app to separate GCP project (`df-superadmin-prod`)
12. Update Stripe webhook URL to new admin app endpoint

---

## 19. Data Model

### Additions to Shared Tables

```sql
-- Written by admin app; read by main app
ALTER TABLE tenants
  ADD COLUMN license_blob    TEXT,           -- base64(signedJWT) per S073
  ADD COLUMN license_updated TIMESTAMPTZ;
```

### Admin-Owned Tables

```sql
-- Super admin users (separate from main app users)
CREATE TABLE admin_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) NOT NULL UNIQUE,    -- must be @designfoundry.ai
  google_sub      VARCHAR(255) NOT NULL UNIQUE,    -- Google OAuth subject (sub claim)
  name            VARCHAR(255) NOT NULL,
  role            VARCHAR(16) NOT NULL DEFAULT 'admin',  -- 'admin' | 'viewer' (viewer = read-only in v1)
  status          VARCHAR(16) NOT NULL DEFAULT 'active', -- 'active' | 'disabled'
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES admin_users(id)
);

-- All issued licenses (SaaS auto-generated + on-prem manual)
CREATE TABLE licenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id      VARCHAR(64) NOT NULL UNIQUE,   -- jti field in JWT
  tenant_id       UUID REFERENCES tenants(id) ON DELETE SET NULL,
  customer_name   VARCHAR(255) NOT NULL,
  contact_email   VARCHAR(255) NOT NULL,
  delivery_model  VARCHAR(16) NOT NULL,           -- 'saas' | 'on_prem' | 'dev'
  plan            VARCHAR(32) NOT NULL,
  addons          JSONB NOT NULL DEFAULT '[]',
  issued_at       TIMESTAMPTZ NOT NULL,
  expires_at      TIMESTAMPTZ,                    -- null = perpetual
  license_blob    TEXT NOT NULL,                  -- the signed JWT
  key_id          VARCHAR(64) NOT NULL,           -- kid used for signing
  status          VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Revoked licenses; read by main app on validation
CREATE TABLE revoked_licenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id  VARCHAR(64) NOT NULL UNIQUE,
  revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason      TEXT,
  revoked_by  UUID   -- admin user ID
);

-- Feature flags + platform settings; read by main app (60s TTL cache)
CREATE TABLE platform_settings (
  key         VARCHAR(128) PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID
);

-- Admin audit log
CREATE TABLE admin_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id   UUID NOT NULL,
  action          VARCHAR(64) NOT NULL,
  target_type     VARCHAR(32),   -- 'tenant' | 'user' | 'license' | 'subscription' | 'settings'
  target_id       UUID,
  details         JSONB,
  ip_address      VARCHAR(45),
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Platform activity events (written by main app + admin app; read by admin app)
CREATE TABLE platform_activity_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type      VARCHAR(64) NOT NULL,
  severity        VARCHAR(8) NOT NULL DEFAULT 'INFO',
  details         JSONB,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_tenant   ON platform_activity_log(tenant_id);
CREATE INDEX idx_activity_type     ON platform_activity_log(event_type);
CREATE INDEX idx_activity_created  ON platform_activity_log(created_at DESC);
CREATE INDEX idx_admin_audit_admin ON admin_audit_log(admin_user_id);

-- Support tickets
CREATE TABLE support_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  reporter_email  VARCHAR(255) NOT NULL,
  reporter_name   VARCHAR(255),
  subject         VARCHAR(255) NOT NULL,
  body            TEXT NOT NULL,
  priority        VARCHAR(8) NOT NULL DEFAULT 'normal',
  status          VARCHAR(16) NOT NULL DEFAULT 'open',
  assigned_to     UUID,
  internal_notes  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);
```

---

## 20. API Design (Admin App)

**Auth:** All `/api/*` endpoints require the admin app's own JWT (Google SSO session). Invitations and webhook are exception — see below.

```
GET    /api/stats                          → Overview KPIs
GET    /api/tenants                        → Tenant list
GET    /api/tenants/:id                    → Tenant detail
PATCH  /api/tenants/:id                    → Update tenant
POST   /api/tenants/:id/suspend            → Suspend tenant
POST   /api/tenants/:id/activate           → Reactivate tenant
DELETE /api/tenants/:id                    → Delete tenant

GET    /api/tenants/:id/users              → Tenant users
PATCH  /api/users/:id                      → Update user (cross-tenant)
POST   /api/users/:id/disable              → Disable user globally

GET    /api/billing/overview               → Billing stats
GET    /api/billing/failed-payments        → Failed payments queue
POST   /api/billing/retry-payment          → Retry payment
POST   /api/billing/refund                 → Issue refund

GET    /api/licenses                       → All licenses
POST   /api/licenses                       → Generate new license
GET    /api/licenses/:id                   → License detail
POST   /api/licenses/:id/extend            → Extend license
POST   /api/licenses/:id/revoke            → Revoke license
GET    /api/licenses/:id/download          → Download .lic file
POST   /api/licenses/:id/email             → Email .lic to customer

GET    /api/activity                       → Platform activity log
GET    /api/activity/export                → CSV export

GET    /api/system/health                  → System health metrics
GET    /api/system/errors                  → Recent errors

GET    /api/settings                       → Platform settings
PATCH  /api/settings                       → Update settings
GET    /api/settings/feature-flags         → Feature flags
PATCH  /api/settings/feature-flags         → Update flags
GET    /api/settings/email-templates       → Email templates
PATCH  /api/settings/email-templates/:id   → Update template

GET    /api/audit                          → Admin audit log

# ── Invitation endpoints (no auth required) ──────────────────────────
POST   /api/admin/invitations              → Invite a @designfoundry.ai admin
GET    /api/admin/invitations/:token       → Get invitation details
POST   /api/admin/invitations/:token/accept → Accept invitation (OAuth callback completes account)

# ── Webhook endpoints (no JWT auth — Stripe signature verified) ──────
POST   /webhooks/stripe                    → Stripe webhook receiver (public)
```

---

## 21. Security

### 21.1 Access Control — `@designfoundry.ai` Domain Gate

**Primary rule: Only users with `@designfoundry.ai` email addresses can access this app.**

- **Authentication:** Google Workspace OIDC SSO (same identity provider as main app — S010)
- **Authorization gate:** During OIDC callback, the app verifies `email.endsWith('@designfoundry.ai')` before issuing a session JWT. Non-`designfoundry.ai` emails are rejected at login.
- **No password login** — SSO only. No local password database in the admin app.
- **No VPN, no IP allowlist** — domain + SSO is the access gate. The app is reachable via the internet but only authenticates `designfoundry.ai` accounts.
- **No public signup** — new admins are invited by existing admins. Invitation email must be `@designfoundry.ai`.
- **Separate from main app auth** — the admin app maintains its own session JWT (`ADMIN_JWT_SECRET`), unrelated to the main app's NextAuth session.

```
┌─────────────────────────────────────────────────────────────────┐
│  Admin navigates to superadmin.designfoundry.ai                  │
│                          ↓                                       │
│  Redirects to Google OAuth 2.0 (designfoundry.ai workspace)     │
│                          ↓                                       │
│  Admin signs in with @designfoundry.ai account                   │
│                          ↓                                       │
│  Google returns ID token with email claim                        │
│                          ↓                                       │
│  Admin app verifies: email.endsWith('@designfoundry.ai')          │
│    ✗ → 403 Forbidden (email not from allowed domain)            │
│    ✓ → issue admin session JWT                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 21.2 Invitation Flow

1. Existing admin creates invitation: `POST /api/admin/invitations` with `@designfoundry.ai` email
2. System sends invitation email with a one-time accept link
3. Invitee clicks link → completes Google OAuth → account created
4. Invitation links expire after 7 days

### 21.3 RSA Private Key

| Environment | Private Key | Public Key |
|---|---|---|
| **Production** | GCP Cloud KMS (HSM-backed) | Env var `LICENSE_PUBLIC_KEY` in main app |
| **Staging** | GCP Secret Manager (PEM string) | Env var in staging deployment |
| **Development** | `./keys/private.pem` (auto-generated, gitignored) | `./keys/public.pem` (gitignored) |

### 21.4 Admin Actions

All admin actions logged to `admin_audit_log` with: admin ID + email + IP + timestamp + action + target.

### 21.5 Stripe

- Stripe webhook (`POST /webhooks/stripe`) is **public** — Stripe sends from known IPs; signature verification is the security mechanism, not auth
- All other admin billing endpoints (`GET/PATCH /api/billing/*`) require admin session JWT
- `STRIPE_SECRET_KEY` never leaves the admin app

| Concern | Mitigation |
|---|---|
| Admin app access | Google Workspace OIDC + `@designfoundry.ai` domain gate |
| RSA private key | GCP Cloud KMS (prod); `./keys/private.pem` gitignored (dev) |
| Admin authentication | Google SSO; own admin JWT per session |
| Admin actions | All logged to `admin_audit_log` with admin ID + IP |
| Stripe secrets | Admin app only; never in main app |
| License blob | Signed JWT; forgery requires RSA private key |
| Revocation | Checked on every license validation in main app |
| Feature flag changes | Audit-logged with old and new values |

---

## 22. UI/UX Notes

- **Sidebar navigation** — fixed left sidebar
- **Data tables** — sortable columns, pagination (25/50/100 per page), bulk selection
- **Filters** — sticky filter bar, persisted in URL params
- **Responsive** — desktop primary; tablet acceptable; mobile not targeted
- **Charts** — Recharts or Tremor for visualizations
- **Loading states** — skeleton loaders (not spinners)
- **Toasts** — success/error feedback for all actions
- **Confirmation modals** — all destructive actions require typed confirmation

---

## 23. Dependencies

| Dependency | Purpose |
|---|---|
| PostgreSQL | Shared with main app |
| Stripe API | Billing data, webhooks, subscriptions |
| GCP Cloud KMS | RSA signing in production |
| GCP Secret Manager | Stripe key, JWT secret |
| Redis (optional) | Dashboard KPI cache (TTL 5m) |
| **S073** | Unified License Architecture — format this app generates |
| **S025** | Free Community Tier — plan limits encoded in licenses |
| **S026** | Self-Serve Trial — trial license lifecycle |

---

## 24. Linked Specs

- **S073 — Unified License Architecture** — defines the license format, enforcement, and key management
- **S025 — Free Community Tier** — tier limits encoded in license payloads
- **S026 — Self-Serve Trial** — trial license and downgrade flow
- **S021 — SaaS Cloud Hosted** — deployment context
- **S022 — Self-Hosted / On-Prem** — on-prem license delivery

---

*Last updated: 2026-04-18*
