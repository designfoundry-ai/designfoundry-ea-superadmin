# R1-08 — Cross-Instance Tenant Portal

**Spec ID:** R1-08  
**Title:** Cross-Instance Tenant Portal  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

The Cross-Instance Tenant Portal extends the single-instance Tenant Management (R1-02) to operate across all registered deployments. It provides a unified view of every tenant in the platform — regardless of which instance they belong to — with instance-aware filtering, cross-instance aggregate statistics, and drill-down into individual tenant details (which live on their respective instances).

This spec is the multi-instance counterpart to R1-02. Where R1-02 assumes a single deployment, R1-08 adds the instance dimension throughout.

---

## 2. Goals

- [ ] **Cross-Instance Tenant List** — all tenants across all instances in one unified table
- [ ] **Instance Filter** — filter by specific instance or "All Instances"
- [ ] **Cross-Instance Aggregate Stats** — total tenants, total MRR, total users across all instances
- [ ] **Per-Tenant Instance Context** — each tenant row shows which instance they belong to
- [ ] **Rich Per-Tenant Overview** — projects, objects, users, usage/activity patterns, last active, license status
- [ ] **Drill-Down to Instance** — clicking a tenant opens their detail on the correct instance
- [ ] **Usage Activity Patterns** — last 7d / 30d / 90d activity indicators per tenant

---

## 3. Non-Goals

- Writing to tenants on remote instances directly from the portal (read-only cross-instance view; writes go through instance-specific API)
- Cross-instance tenant migration (Phase 2 — R1-13 Instance Provisioning)
- Real-time cross-instance WebSocket feeds (polling acceptable)

---

## 4. User Story

> As a **Platform Operator**,  
> I want to see every tenant across all deployments in one view, with usage statistics and activity patterns,  
> so that I can identify unhealthy tenants, compare usage across regions, and drill down into specific tenants without needing to know which instance they live on.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Cross-instance tenant list shows all tenants | E2E | All tenants from all instances listed |
| AC2 | Instance filter shows correct subset | E2E | Select "Acme EU" → only that instance's tenants |
| AC3 | "All Instances" shows complete list | E2E | All instances selected → total matches sum |
| AC4 | Aggregate stats match sum of all instances | Unit | Total MRR = sum of per-instance MRR |
| AC5 | Tenant row shows instance name | Visual | Instance badge on each row |
| AC6 | Per-tenant overview shows richer data | Visual | Detail page: projects, activity chart, recent events |
| AC7 | Activity patterns (7d/30d/90d) shown | Visual | Activity indicators on tenant detail |
| AC8 | Drill-down → correct instance detail | E2E | Click tenant → navigates to that instance's tenant detail |
| AC9 | Usage bar charts on per-tenant overview | Visual | Objects/diagrams usage bars with % fill |

---

## 6. Functional Requirements

### FR-1: Cross-Instance Tenant List

Same table structure as R1-02 with one additional column: **Instance**.

Additional filter: **Instance** dropdown (lists all registered instances from R1-07 + "All Instances" option).

Cross-instance aggregation row (sticky footer or header):
```
Total across all instances: 142 tenants · $28,400 MRR · 1,847 users
```

Query strategy:
- Fan-out query: for each instance, run the same tenant list query in parallel
- Aggregate in superadmin backend
- Return unified list with `instanceId` and `instanceName` on each tenant
- Sort/filter applied after aggregation (client-side sort for R1; server-side for Phase 2)

### FR-2: Instance Filter

Dropdown values:
- "All Instances" (default)
- Per-instance names from the registry

When an instance is selected:
- Tenant list filtered to that instance only
- Aggregate stats show only that instance's totals
- All other R1-02 filters still work (plan, status, search, date range)

### FR-3: Cross-Instance Aggregate Stats

Stats shown in the list header (same as R1-02 overview KPI row, but aggregated):
| Metric | Calculation |
|--------|-------------|
| Total Tenants | Sum of all instance tenant counts |
| Total MRR | Sum of all instance MRRs |
| Total Users | Sum of all instance user counts |
| Active Instances | Count of instances with `status = active` |

### FR-4: Rich Per-Tenant Overview

When a tenant row is clicked → `/superadmin/tenants/:instanceId/:tenantId` (instance-scoped route).

The detail page is the same as R1-02's detail page, but loaded from the correct instance's API.

Additional sections specific to cross-instance view:

#### FR-4a: Instance Context Banner
```
┌─────────────────────────────────────────────────────────────┐
│ 🟢 On-Prem · Acme EU Production · EU-West                   │
│ Tenant hosted on: Acme EU Production (v1.4.2)               │
└─────────────────────────────────────────────────────────────┘
```

#### FR-4b: Usage Activity Chart
- Line chart: Daily active users over last 90 days
- Bar chart: Objects created / diagrams created per week
- Data queried from instance's own API on load

#### FR-4c: Projects Summary (if applicable)
- Number of projects
- Last project activity
- Top 3 most active projects

### FR-5: Usage Activity Patterns

Per-tenant indicators:
| Indicator | Logic |
|-----------|-------|
| 🟢 Active (7d) | Last activity within 7 days |
| 🟡 Active (30d) | Last activity within 30 days |
| 🟠 Active (90d) | Last activity within 90 days |
| ⚪ Inactive | No activity in 90+ days |

Shown as badge on tenant list rows and in detail page header.

---

## 7. API Design

### GET /api/v1/superadmin/instances/:instanceId/tenants

Same response shape as R1-02, but scoped to one instance (used for drill-down).

### GET /api/v1/superadmin/tenants/cross-instance

Aggregated endpoint (used for cross-instance list).

#### Query Params
Same as R1-02 + `instanceId` (optional filter).

#### Response 200 OK
```json
{
  "tenants": [
    {
      "id": "uuid",
      "instanceId": "uuid",
      "instanceName": "Acme EU Production",
      "name": "Acme Corp",
      "plan": "professional",
      "status": "active",
      "mrr": 990,
      "usersCount": 47,
      "objectsCount": 1823,
      "diagramsCount": 312,
      "storageUsedMb": 2847,
      "primaryEmail": "admin@acme.com",
      "createdAt": "2024-03-15T10:00:00Z",
      "lastActiveAt": "2025-04-24T08:12:00Z",
      "activityLevel": "active_7d"
    }
  ],
  "aggregates": {
    "totalTenants": 142,
    "totalMRR": 28400,
    "totalUsers": 1847,
    "activeInstances": 4
  },
  "total": 142,
  "page": 1,
  "limit": 25
}
```

### GET /api/v1/superadmin/instances/:instanceId/tenants/:tenantId

Per-tenant detail from a specific instance (same shape as R1-02 tenant detail).

### GET /api/v1/superadmin/instances/:instanceId/tenants/:tenantId/usage

Activity data for a specific tenant.

#### Response 200 OK
```json
{
  "activeUsersHistory": [
    { "date": "2025-04-18", "count": 38 },
    { "date": "2025-04-19", "count": 42 }
  ],
  "objectActivity": [
    { "week": "2025-W16", "created": 24, "edited": 67 }
  ],
  "projectCount": 8,
  "lastProjectActivity": "2025-04-24T08:12:00Z",
  "topProjects": [
    { "id": "uuid", "name": "Customer Platform", "lastActivity": "2025-04-24" }
  ]
}
```

---

## 8. Data Model Changes

No new entities. Tenants and usage data live on their respective instances. Superadmin app reads from remote instance DBs via connection pools (R1-07).

### Existing Entity Changes: `tenants`
| Change | Notes |
|--------|-------|
| + `instance_id` (uuid) | FK to `instances.id` — added in R1-07 |

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cross-instance query | Fan-out to all instances in parallel | Fast; doesn't serialize through single hop |
| Timeout per instance | 5 second timeout per instance | Slow instances don't block the whole view |
| Stale data | Accept slightly stale data (< 60 s) | Acceptable for admin dashboard |
| Sort/filter | Client-side for R1; server-side with aggregate query for Phase 2 | Simpler implementation for R1 |
| Instance offline | Show "N/A" for that instance's tenants | Don't fail entire list if one instance is down |

### Fan-Out Query Pattern
```typescript
async function getCrossInstanceTenants(filters) {
  const instances = await getActiveInstances();
  const results = await Promise.allSettled(
    instances.map(inst =>
      fetchFromInstance(inst.id, `/tenants`, filters)
    )
  );
  const successful = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value.tenants.map(t => ({ ...t, instanceId: r.instanceId })));
  return sortAndPaginate(successful, filters);
}
```

---

## 10. UI/UX Requirements

### Cross-Instance Tenant List
```
┌────────────────────────────────────────────────────────────────────────────┐
│ Tenants (All Instances ▼)        [142 total · $28,400 MRR · 1,847 users] │
├────────────────────────────────────────────────────────────────────────────┤
│ [Search...]  [Plan ▼]  [Status ▼]  [Instance ▼]  [From]  [To]            │
├────────────────────────────────────────────────────────────────────────────┤
│ Instance         │ Tenant      │ Plan │ Status │ Users │ MRR  │ ···        │
│ Acme EU Pro      │ Acme Corp   │ Pro  │ Active │ 47    │ $990 │ ···       │
│ DF SaaS EU       │ Beta Corp   │ Team │ Trial  │ 12    │ $0   │ ···       │
│ Beta Cloud-Manage │ Gamma Inc   │ Entr │ Active │ 312   │ $2990│ ···       │
├────────────────────────────────────────────────────────────────────────────┤
│ Showing 1-25 of 142  [All Instances · 4 deployments]                       │
└────────────────────────────────────────────────────────────────────────────┘
```

### Instance Badge Colors
| Type | Color |
|------|-------|
| SaaS | Green (`#10b981`) |
| Cloud-Managed | Blue (`#3b82f6`) |
| On-Prem | Gray (`#64748b`) |

### Tenant Detail — Instance Context
```
┌─────────────────────────────────────────────────────────────┐
│ ← Back to All Tenants                                        │
│                                                             │
│ Acme Corp                        [Suspend] [Delete]         │
│ admin@acme.com · Professional · Active                      │
│ 🟢 Instance: Acme EU Production · EU-West                   │
├─────────────────────────────────────────────────────────────┤
│ ⚠ Viewing tenant on: Acme EU Production                     │
│ [Open in Instance ↗]                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| Cross-instance DB access | Read-only via credentials from R1-07 registry |
| Instance credentials | Encrypted; used only for fan-out queries |
| Tenant data across instances | GDPR: tenant data stays on its instance; no cross-border aggregation beyond metadata |
| Audit | Fan-out queries logged as `tenant.list.cross_instance` |

---

## 12. Out of Scope

- Writing to remote tenants (read-only; writes go through instance-specific admin routes)
- Cross-instance tenant search (full-text search stays per-instance for R1)
- Real-time cross-instance WebSocket updates

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Sort on cross-instance list | Server-side sort (slow) vs client-side | Client-side for R1; server-side aggregate in Phase 2 |
| Instance offline handling | Fail entire list vs show N/A | Show N/A for that instance; don't block others |
| Activity data freshness | Real-time vs 1-hour lag | 1-hour lag acceptable for admin view |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| R1-07 (Instance Registry) | Required | Instance list + credentials for fan-out queries |
| R1-02 (Tenant Management) | Required | Detail page structure; this spec extends it cross-instance |

---

## 15. Linked Specs

- **R1-02** (Tenant Management) — Detail page structure reused; same tabs (Overview, Users, Billing, Activity, Settings)
- **R1-07** (Instance Registry) — Instance list for filter; credentials for fan-out
- **R1-09** (Cross-Instance Observability) — Aggregate health + MRR across instances

---

## 16. Verification & Testing

### Test Cases
| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Cross-instance list: all tenants from 3 instances | 142 total from 3 instances | E2E |
| TC2 | Filter by instance → only that instance's tenants | 12 tenants from selected instance | E2E |
| TC3 | Aggregate stats correct | MRR sum = sum of all instances | Unit |
| TC4 | Instance offline → N/A shown for its tenants | Instance shows "unavailable"; others load | E2E |
| TC5 | Activity pattern badges correct | Active 7d badge when recent activity | Unit |
| TC6 | Drill-down to tenant detail on correct instance | Correct tenant data from correct instance | E2E |
| TC7 | 5s timeout on slow instance → other instances load | Partial results shown; timed-out instance shows error | Integration |
