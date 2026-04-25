# R1-01 — Overview Dashboard

**Spec ID:** R1-01  
**Title:** Super Admin Console — Overview Dashboard  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

The Overview Dashboard is the landing page of the Super Admin Console (`/`). It gives platform operators an at-a-glance view of the entire DesignFoundry platform: business metrics (MRR, ARR, tenants, churn), growth trends, and system health. It is the first thing an admin sees when they log in.

---

## 2. Goals

- [ ] Display real-time KPI cards: total tenants, active MRR, ARR, total users, churn rate, trial tenant count
- [ ] MRR growth line chart (last 12 months)
- [ ] Weekly signup bar chart (last 12 weeks)
- [ ] Tenant status donut chart (active / trial / past due / cancelled)
- [ ] Top 10 tenants by usage (objects + diagrams combined)
- [ ] Monthly churn rate trend line
- [ ] System status banner with service health indicators (API, PostgreSQL, Redis)
- [ ] Recent activity feed (last 20 platform events)
- [ ] Auto-refresh on load; manual refresh button

---

## 3. Non-Goals

- Real-time WebSocket-driven updates (polling every 60 s is sufficient)
- Historical drill-down beyond what the charts show (dedicated pages handle detail)
- Tenant-level filtering on the overview (filters belong on the Tenants page)

---

## 4. User Story

> As a **Platform Operator**,  
> I want to see the key business metrics and system health in one view when I log in,  
> so that I can immediately spot issues (e.g. elevated churn, system errors) without navigating anywhere.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Overview page is the default route (`/superadmin`) | E2E | Navigate to `/superadmin` → dashboard loads |
| AC2 | KPI cards show correct values from API | Unit/E2E | Mock stats API → card values match |
| AC3 | MRR chart renders with correct data points | Visual + unit | API returns 12 months → 12 points plotted |
| AC4 | System status banner shows service health | Visual | Services up → green indicators |
| AC5 | Loading skeleton shown while fetching | Visual | Slow API → skeleton loader visible |
| AC6 | Error state shown if API fails | E2E | API returns 500 → error message displayed |
| AC7 | Manual refresh button reloads all data | E2E | Click refresh → new API call made |

---

## 6. Functional Requirements

### FR-1: KPI Cards Row
Four cards in a grid: **Total Tenants**, **Active MRR / ARR**, **Total Users**, **Churn Rate**.

Each card shows:
- Metric label
- Primary value (formatted: `1,234` / `$5,600`)
- Sub-text (context: e.g. "active + trial", "ARR: $67,200")
- Optional trend indicator (↑/↓ % vs last month)

Data source: `GET /api/v1/superadmin/stats`

### FR-2: MRR Growth Chart
- Type: Area chart (Recharts `<AreaChart>`)
- X-axis: month (MMM 'YY format)
- Y-axis: dollar amount
- Gradient fill under the line
- Tooltip: formatted dollar value on hover
- Data source: `stats.mrrHistory[]`

### FR-3: Weekly Signups Bar Chart
- Type: Vertical bar chart
- X-axis: week label (e.g. "W1", "W2")
- Y-axis: signup count
- Data source: `stats.signupsHistory[]`

### FR-4: Tenant Status Donut Chart
- Four segments: Active (green), Trial (amber), Past Due (red), Cancelled (slate)
- Center label: total tenant count
- Legend below chart
- Data source: `stats.tenantStatusBreakdown{}`

### FR-5: Top 10 Tenants by Usage
- Horizontal bar chart
- Sorted descending by `objects + diagrams`
- Shows top 10 tenant names + bar
- Data source: `stats.topTenantsByUsage[]`

### FR-6: Churn Rate Trend Line
- Line chart, red color
- X-axis: month, Y-axis: percentage
- Tooltip shows `X%`
- Data source: `stats.churnHistory[]`

### FR-7: System Status Banner
- Shows: API Server, PostgreSQL, Redis, SMTP (or email service)
- Each service: green dot (healthy) / amber (degraded) / red (down) + latency
- Data source: `GET /api/v1/superadmin/system/health`

### FR-8: Recent Activity Feed
- Last 20 events from `GET /api/v1/superadmin/activity?limit=20`
- Shows: timestamp, event type badge, tenant name, brief description
- Read-only list; click navigates to full Activity Log page

### FR-9: Auto-Refresh
- On mount: fetch all data
- Refresh button in page header triggers full reload
- No auto-polling (60 s polling is a future enhancement)

---

## 7. API Design

### GET /api/v1/superadmin/stats

**Auth:** Required (Bearer token, `role=superadmin`)

#### Response 200 OK
```json
{
  "totalTenants": 142,
  "activeMRR": 28400,
  "arr": 340800,
  "totalUsers": 1847,
  "churnRate": 2.1,
  "trialTenants": 23,
  "mrrHistory": [
    { "month": "Jan 25", "mrr": 22100 },
    { "month": "Feb 25", "mrr": 23800 }
  ],
  "signupsHistory": [
    { "week": "W1", "count": 8 },
    { "week": "W2", "count": 12 }
  ],
  "tenantStatusBreakdown": {
    "active": 98,
    "trial": 23,
    "pastDue": 7,
    "canceled": 14
  },
  "topTenantsByUsage": [
    { "tenantId": "uuid", "name": "Acme Corp", "objects": 4821, "diagrams": 234 }
  ],
  "churnHistory": [
    { "month": "Jan 25", "rate": 1.8 },
    { "month": "Feb 25", "rate": 2.1 }
  ]
}
```

### GET /api/v1/superadmin/system/health

**Auth:** Required

#### Response 200 OK
```json
{
  "services": [
    { "name": "API Server", "status": "healthy", "uptime": "99.97%", "latencyMs": 94 },
    { "name": "PostgreSQL", "status": "healthy", "uptime": "99.99%", "latencyMs": 23 },
    { "name": "Redis", "status": "healthy", "uptime": "100%", "latencyMs": 1 }
  ],
  "metrics": {
    "apiErrorRate": 0.3,
    "apiRequestsPerMin": 847,
    "dbConnections": { "current": 12, "max": 100 },
    "redisMemory": { "used": 45, "max": 256 },
    "diskUsage": { "used": 182, "max": 500 }
  }
}
```

---

## 8. Data Model Changes

No new entities. Dashboard is read-only aggregate views from existing data.

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Charts | Recharts | Same library used in scaffold; consistent look |
| Data fetching | React `useEffect` + `useState` | Simple for now; upgrade to React Query when cache invalidation is needed |
| Error handling | Per-component error state | Each card/chart shows its own error; doesn't block whole page |
| Skeleton loading | Tailwind `animate-pulse` | No extra dependency needed |

---

## 10. UI/UX Requirements

### Page Layout
```
┌─────────────────────────────────────────────────────────────────┐
│ [Sidebar]  │  Page Header: "Platform Overview"  [🔄 Refresh]   │
│            │                                                   │
│            │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│            │  │ KPI  │ │ KPI  │ │ KPI  │ │ KPI  │            │
│            │  └──────┘ └──────┘ └──────┘ └──────┘            │
│            │                                                   │
│            │  ┌──────────────────┐  ┌──────────┐              │
│            │  │  MRR Growth     │  │ Tenant  │              │
│            │  │  (area chart)   │  │ Status  │              │
│            │  └──────────────────┘  └──────────┘              │
│            │                                                   │
│            │  ┌──────────────────┐  ┌──────────────────┐    │
│            │  │  Weekly Signups  │  │  Churn Trend      │    │
│            │  └──────────────────┘  └──────────────────┘    │
│            │                                                   │
│            │  ┌─────────────────────────────────────────┐   │
│            │  │  System Status Banner                     │   │
│            │  └─────────────────────────────────────────┘   │
│            │                                                   │
│            │  ┌─────────────────────────────────────────┐   │
│            │  │  Recent Activity Feed                    │   │
│            │  └─────────────────────────────────────────┘   │
└────────────┴─────────────────────────────────────────────────┘
```

### Key Screens

| Screen | Purpose |
|--------|---------|
| `/superadmin` | Default dashboard view |

### Responsive Strategy
- Primary target: desktop (1440 px)
- Sidebar collapses to icon-only at < 1024 px
- Cards switch from 4-column to 2-column grid at < 768 px

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| Authentication | All API calls require `Authorization: Bearer <token>` |
| Authorization | `role=superadmin` enforced server-side on all `/superadmin/*` routes |
| Data exposure | Dashboard shows aggregate metrics only; no tenant raw data beyond totals |
| Audit | All stat snapshots are read-only — no writes, no audit log entry needed |

---

## 12. Out of Scope

- Historical drill-down charts (use dedicated Tenants or Activity pages)
- Custom date range selection on charts (Phase 2)
- WebSocket real-time updates (Phase 2)
- Exporting dashboard as PDF/PNG (Phase 2)

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Chart time range | Last 30 days vs 12 months | 12 months for business review cadence |
| System status services | Which services to monitor beyond DB/Redis? | API + DB + Redis + SMTP as Phase 1 baseline |
| Refresh interval | Polling vs manual only | Manual + 60 s future polling |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| `GET /api/v1/superadmin/stats` | API endpoint | Backend must exist — blocked on backend implementation |
| `GET /api/v1/superadmin/system/health` | API endpoint | Backend must exist |
| Recharts | UI library | Already in `package.json` |

---

## 15. Linked Specs

- **R1-06** (Observability) — System health endpoint; audit log
- **R1-02** (Tenant Management) — Drill-down from top tenants list

---

## 16. Verification & Testing

### Test Cases
| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Load `/superadmin` with valid token | Dashboard with KPI cards renders | E2E |
| TC2 | API `/stats` returns data | KPI values match API response | Unit |
| TC3 | API `/stats` returns error | Error state shown per component | E2E |
| TC4 | Click refresh button | New API calls fired, loading state shown | E2E |
| TC5 | System health shows all services | Services listed with status indicators | Visual |
| TC6 | Recent activity feed loads | Last 20 events displayed | E2E |
