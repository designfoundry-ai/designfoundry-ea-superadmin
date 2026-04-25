# R1-02 — Tenant Management

**Spec ID:** R1-02  
**Title:** Super Admin Console — Tenant Management  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

Tenant Management is the core operational page for the super admin console. It provides a full CRUD interface for all tenants across all DesignFoundry deployments: list with filtering/sorting, per-tenant detail view with sub-tabs (Overview, Users, Billing, Activity, Settings), and bulk actions (suspend, activate).

This spec covers both the cross-instance tenant list and the per-tenant detail page with all its tabs.

---

## 2. Goals

- [ ] **Tenant List** — sortable, filterable table of all tenants across all known deployments
- [ ] **Filters** — by plan (Free/Team/Professional/Enterprise), status (Active/Trial/Suspended/Cancelled), date range, name search
- [ ] **Per-Tenant Detail** — five tabs: Overview, Users, Billing, Activity, Settings
- [ ] **Overview Tab** — usage stats (objects, diagrams, users, storage), 30-day trend chart, quick actions
- [ ] **Users Tab** — all users in this tenant: name, email, role, last login; per-user actions
- [ ] **Billing Tab** — current Stripe subscription, invoices, payment method, upgrade/downgrade/cancel
- [ ] **Activity Tab** — all events for this tenant
- [ ] **Settings Tab** — tenant name, email, timezone, suspend/activate toggle, danger zone (delete)
- [ ] **Bulk Actions** — Suspend selected, Export CSV
- [ ] **Pagination** — 25/50/100 per page, URL-param persisted

---

## 3. Non-Goals

- Tenant creation (tenants self-serve via the main app's signup flow)
- Direct SQL editing (all operations via API)
- Two-way messaging with tenants (separate support module)
- Billing invoice generation (Stripe owns invoice PDFs)

---

## 4. User Story

> As a **Platform Operator**,  
> I want to view and manage all tenants from one console,  
> so that I can handle suspension requests, investigate billing issues, and monitor tenant health without logging into individual deployments.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Tenant list loads with pagination | E2E | Navigate to `/superadmin/tenants` → table shows first 25 tenants |
| AC2 | Filter by plan returns correct subset | E2E | Select "Enterprise" plan filter → only Enterprise tenants shown |
| AC3 | Filter by status returns correct subset | E2E | Select "Suspended" → only suspended tenants shown |
| AC4 | Search by name matches partial string | E2E | Search "Acme" → tenants with "Acme" in name shown |
| AC5 | Click tenant row → detail page opens | E2E | Click "Acme Corp" row → `/tenants/uuid` loads |
| AC6 | Suspend tenant → status changes to Suspended | E2E | Click Suspend → confirmation modal → confirm → status = Suspended |
| AC7 | Delete tenant → requires typed confirmation | E2E | Click Delete → type tenant name → confirm → tenant removed |
| AC8 | Overview tab shows usage stats + chart | Visual | Tenant detail → Overview tab → 4 stat cards + trend chart |
| AC9 | Users tab lists all tenant users | E2E | Tenant detail → Users tab → user table with all fields |
| AC10 | Billing tab shows Stripe subscription | Visual | Tenant detail → Billing tab → subscription card + invoices |
| AC11 | Settings tab toggle suspend/activate | E2E | Toggle switch → tenant status changes |
| AC12 | Bulk suspend selected tenants | E2E | Select 3 checkboxes → Bulk Suspend → all 3 suspended |

---

## 6. Functional Requirements

### FR-1: Tenant List Table

Columns: Tenant Name · Plan · Status · Users · Objects · MRR · Created · Last Active · Actions

- Sortable: Tenant Name, Plan, Status, MRR, Created, Last Active
- Filters (sticky bar, URL-persisted): plan, status, date range (from/to), name search
- Bulk selection: checkbox per row + "Select all on page"
- Bulk actions: Suspend Selected, Export CSV
- Row click → navigate to tenant detail
- Actions column: View (→ detail), Suspend, Delete

### FR-2: Tenant Detail Page

Route: `/superadmin/tenants/:id`

Header: org name, admin email, creation date, plan badge, status badge, MRR.

Sub-navigation tabs: Overview · Users · Billing · Activity · Settings

#### FR-2a: Overview Tab
- Stat cards: Objects, Diagrams, Users, Storage (MB)
- 30-day usage trend (line chart)
- Quick actions panel: Send Email, Open as Admin, Suspend, Upgrade Plan

#### FR-2b: Users Tab
Table columns: Name · Email · Role · Status · Last Login · Actions

Actions per user: Change Role, Force Password Reset, Revoke Sessions, Disable, Delete

#### FR-2c: Billing Tab
- Stripe subscription card: plan name, status, current period, next billing date, amount
- Payment method (masked: Visa •••• 4242)
- Recent invoices table: date, amount, status, PDF link
- Actions: Change Plan, Issue Refund, Cancel Subscription, Retry Failed Payment

#### FR-2d: Activity Tab
All events for this tenant (same schema as platform activity log, filtered by `tenantId`).

#### FR-2e: Settings Tab
Form fields: Tenant Name, Primary Contact Email, Tenant Timezone.

Danger zone:
- Suspend/Activate toggle
- Delete Tenant (requires typing full tenant name to confirm)

### FR-3: Pagination
- Server-side pagination
- Page sizes: 25 (default), 50, 100
- URL params: `?page=2&limit=50&plan=enterprise&status=active`
- Previous/Next buttons + "Showing X–Y of Z"

---

## 7. API Design

### GET /api/v1/superadmin/tenants

**Auth:** Required (Bearer token, `role=superadmin`)

#### Query Parameters
| Param | Type | Notes |
|-------|------|-------|
| `plan` | `free\|team\|professional\|enterprise` | Optional filter |
| `status` | `active\|trial\|suspended\|canceled` | Optional filter |
| `search` | `string` | Partial match on tenant name |
| `from` | `ISO-8601` | Created after |
| `to` | `ISO-8601` | Created before |
| `instanceId` | `uuid` | Filter by deployment instance |
| `page` | `number` | Default: 1 |
| `limit` | `number` | Default: 25, max: 100 |

#### Response 200 OK
```json
{
  "tenants": [
    {
      "id": "uuid",
      "name": "Acme Corp",
      "slug": "acme-corp",
      "plan": "professional",
      "status": "active",
      "mrr": 990,
      "usersCount": 47,
      "objectsCount": 1823,
      "diagramsCount": 312,
      "storageUsedMb": 2847,
      "stripeCustomerId": "cus_xxx",
      "primaryEmail": "admin@acme.com",
      "createdAt": "2024-03-15T10:00:00Z",
      "lastActiveAt": "2025-04-24T08:12:00Z",
      "trialEndsAt": null
    }
  ],
  "total": 142,
  "page": 1,
  "limit": 25
}
```

### GET /api/v1/superadmin/tenants/:id

#### Response 200 OK
```json
{
  "id": "uuid",
  "name": "Acme Corp",
  "slug": "acme-corp",
  "plan": "professional",
  "status": "active",
  "mrr": 990,
  "usersCount": 47,
  "objectsCount": 1823,
  "diagramsCount": 312,
  "storageUsedMb": 2847,
  "stripeCustomerId": "cus_xxx",
  "primaryEmail": "admin@acme.com",
  "createdAt": "2024-03-15T10:00:00Z",
  "lastActiveAt": "2025-04-24T08:12:00Z",
  "trialEndsAt": null,
  "instanceId": "uuid",
  "timezone": "Europe/Warsaw"
}
```

### PATCH /api/v1/superadmin/tenants/:id

#### Request
```json
{
  "name": "Acme GmbH",
  "primaryEmail": "new@acme.com",
  "timezone": "Europe/Berlin",
  "status": "suspended"
}
```

#### Response 200 OK
Updated tenant object.

### DELETE /api/v1/superadmin/tenants/:id

**Auth:** Requires typing tenant name in UI confirmation body.

#### Response 204 No Content

### POST /api/v1/superadmin/tenants/:id/suspend
### POST /api/v1/superadmin/tenants/:id/activate

#### Response 200 OK

---

## 8. Data Model Changes

### New Entity: `admin_tenants` (if not already in main DB)
Owned by the superadmin app. Main app reads `tenants` table (owned by main app). Superadmin app writes its own `tenant_settings` overlay.

For R1 — Option A (shared DB, separate tables):
- Superadmin app reads from existing `tenants` and `users` tables
- Superadmin app owns: `admin_audit_log`, `platform_activity_log`, `support_tickets`, `licenses`, `revoked_licenses`, `platform_settings`
- No new shared tables needed for tenant management

### New Entity: `tenant_settings` (superadmin-owned)
| Column | Type | Notes |
|--------|------|-------|
| tenant_id | uuid | FK to shared `tenants.id` |
| timezone | varchar | IANA timezone string |
| internal_notes | text | Admin-only notes |
| suspended_at | timestamptz | Null when active |
| suspended_reason | varchar | Admin-provided reason |

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Table library | TanStack Table (or manual table) | Lightweight; sortable headers |
| Date filtering | Native date inputs + URL params | No date picker library needed |
| Confirmation | Browser `window.confirm` for simple actions; inline text input for destructive | Simple and safe |
| Instance filter | Dropdown of known instances (from R1-07 registry) | Pre-filters tenants to one deployment |

---

## 10. UI/UX Requirements

### Tenant List Layout
```
┌────────────────────────────────────────────────────────────────────┐
│ Tenants                                           [+ Add Tenant]  │
├────────────────────────────────────────────────────────────────────┤
│ [Search...]  [Plan ▼]  [Status ▼]  [From]  [To]  [Instance ▼]     │
├────────────────────────────────────────────────────────────────────┤
│ ☐ │ Tenant      │ Plan │ Status │ Users │ MRR  │ Created │ Actions │
│ ☑ │ Acme Corp   │ Pro  │ Active │ 47    │ $990 │ Mar 2024│ ···    │
│ ☐ │ Beta Corp   │ Team │ Trial  │ 12    │ $0   │ Apr 2025│ ···    │
├────────────────────────────────────────────────────────────────────┤
│ Showing 1-25 of 142    [<] Page 1 of 6 [>]   [25▼ per page]       │
└────────────────────────────────────────────────────────────────────┘
```

### Tenant Detail Tabs
```
┌──────────────────────────────────────────────────────────┐
│ ← Back to Tenants                                        │
│                                                         │
│ Acme Corp                        [Suspend] [Delete]      │
│ admin@acme.com · Professional · Active                   │
├──────────┬──────────┬──────────┬──────────┬────────────┤
│ Overview │  Users   │ Billing  │ Activity │  Settings  │
└──────────┴──────────┴──────────┴──────────┴────────────┘
```

### Confirmation Modal (Delete)
- Title: "Delete Tenant"
- Body: "This action cannot be undone. Type the tenant name to confirm."
- Input field for tenant name
- Buttons: Cancel (secondary), Delete (danger, disabled until match)

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| Authentication | All API calls require superadmin JWT |
| Authorization | Only `role=superadmin` can access tenant endpoints |
| Audit | All tenant mutations logged to `admin_audit_log` with admin ID + tenant ID + action |
| Tenant deletion | Soft delete preferred; hard delete requires typed confirmation |
| Suspended tenants | Read-only after suspension; cannot login |

---

## 12. Out of Scope

- Tenant self-service signup (main app flow)
- Billing invoice generation (Stripe-owned)
- Direct database edits (API only)
- Tenant user invitation management (tenant admin does this in their own console)
- Multi-step bulk operations (select → preview → confirm pattern; single bulk action sufficient for Phase 1)

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Tenant deletion | Soft delete vs hard delete | Soft delete (set `deleted_at` timestamp) for auditability |
| Instance filter | Required or optional? | Optional — "All instances" default |
| Bulk export format | CSV only? | CSV for Phase 1; XLSX future enhancement |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| `GET /api/v1/superadmin/tenants` | API | Backend implementation needed |
| `R1-07` (Instance Registry) | Spec | Instance filter dropdown needs instance list |
| Stripe | External | Billing tab needs Stripe subscription data |

---

## 15. Linked Specs

- **R1-01** (Overview Dashboard) — Top tenants widget uses tenant list API
- **R1-03** (Billing & Subscriptions) — Billing tab
- **R1-04** (License Management) — License viewing per tenant
- **R1-06** (Observability) — Activity tab
- **R1-07** (Instance Registry) — Instance filter dropdown
- **R1-09** (Cross-Instance Tenant Portal) — Cross-instance aggregate view builds on this

---

## 16. Verification & Testing

### Test Cases
| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | List tenants with default params | 25 rows, correct total in pagination | E2E |
| TC2 | Filter by "Enterprise" plan | Only enterprise plan tenants | E2E |
| TC3 | Filter by "Suspended" status | Only suspended tenants | E2E |
| TC4 | Search "Acme" | Only tenants with "Acme" in name | E2E |
| TC5 | Open tenant detail | Correct tenant data in all tabs | E2E |
| TC6 | Suspend tenant | Status changes, audit log entry created | E2E |
| TC7 | Delete tenant (typed confirmation) | Tenant removed from list | E2E |
| TC8 | Bulk select + suspend | All selected tenants suspended | E2E |
| TC9 | Paginate to page 2 | Correct rows for page 2 | E2E |
| TC10 | Tenant has 0 users | Empty state shown in Users tab | E2E |
