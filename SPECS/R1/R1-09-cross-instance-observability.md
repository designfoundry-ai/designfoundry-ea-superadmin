# R1-09 — Cross-Instance Observability

**Spec ID:** R1-09  
**Title:** Cross-Instance Observability  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

Cross-Instance Observability provides a unified health and billing snapshot across all registered DesignFoundry deployments (SaaS, cloud-managed, on-prem). It extends the single-instance observability view (R1-06) to aggregate metrics from all instances into one operator dashboard: aggregate MRR/ARR, deployment health comparison, platform-wide activity stream, and incident alerts.

This answers the question: "How is the whole platform doing, across all deployments?"

---

## 2. Goals

- [ ] **Aggregate Health Table** — all instances with health status, latency, last check time
- [ ] **Instance Health Comparison** — compare error rates, latency, and uptime across all instances
- [ ] **Cross-Instance Activity Stream** — merged activity log from all instances, sorted by time
- [ ] **Aggregate Business Metrics** — total MRR, total tenants, total users across all instances
- [ ] **Instance Health History** — last 30 days of health data per instance (uptime %)
- [ ] **Incident Alerts** — highlight instances that are `degraded` or `down` prominently

---

## 3. Non-Goals

- Real-time streaming of cross-instance events (polling acceptable)
- Cross-instance incident management (Phase 2 — separate incident management spec)
- Automated remediation actions (Phase 2)
- External SIEM integration (Phase 2)

---

## 4. User Story

> As a **Platform Operator**,  
> I want to see the health and key metrics of every deployment in one view,  
> so that I can immediately spot which instance is degraded, compare uptime across regions, and see platform-wide activity without logging into each deployment separately.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Health table shows all instances with correct status | E2E | 4 instances → 4 rows with correct status dots |
| AC2 | Degraded instance highlighted prominently | Visual | Instance marked degraded → amber highlight banner |
| AC3 | Cross-instance activity stream merged + sorted by time | E2E | Events from all instances shown; newest first |
| AC4 | Aggregate metrics match sum of all instances | Unit | Total MRR = sum of per-instance MRR |
| AC5 | Instance health history (30 days) visible | Visual | Expand instance → uptime % chart for 30 days |
| AC6 | Instance marked down → red alert banner | E2E | Instance marked down → alert shown at top |
| AC7 | Activity stream filterable by instance + type | E2E | Filter "Acme EU" + "license.created" → correct subset |

---

## 6. Functional Requirements

### FR-1: Aggregate Health Table (`/superadmin/observability`)

Table columns: Instance · Type · Region · Status · Latency · Uptime · Last Check · Tenants · Actions

Status dot colors:
- 🟢 `healthy` — green
- 🟡 `degraded` — amber
- 🔴 `down` — red
- ⚪ `unknown` — gray

Alerts section (above table, prominent):
```
┌─────────────────────────────────────────────────────────────┐
│ 🔴 1 Instance Down: Acme US East                        │
│ [View Instance]  [Trigger Health Check]                  │
└─────────────────────────────────────────────────────────┘
```

### FR-2: Instance Health Comparison

Expandable section per instance:
- **30-day uptime %** line chart
- **Error rate trend** bar chart (last 30 days)
- **Latency trend** line chart (last 30 days)

Used to compare: "Acme EU has 99.99% uptime vs Acme US at 99.87% — why?"

### FR-3: Cross-Instance Activity Stream

Merged from all instances via fan-out query (same pattern as R1-08):
- Events sorted by `createdAt` descending (newest first)
- Each event tagged with `instanceName`
- Infinite scroll pagination (load 50 more on scroll)
- Filters: instance, event type, severity, date range

### FR-4: Aggregate Business Metrics

Displayed at top of observability page:
| Metric | Value |
|--------|-------|
| Total Active Instances | N |
| Total Tenants | N |
| Total MRR | $N |
| Total Users | N |
| Platform-wide Uptime (30d) | 99.X% |

### FR-5: Instance Health History

Per-instance 30-day history stored in `instance_health_history` table (written by health check scheduler from R1-07):

| Field | Type |
|--------|------|
| instance_id | uuid |
| recorded_at | timestamptz |
| status | healthy/degraded/down |
| latency_ms | int |
| error_rate | float |
| uptime | float (% in that period) |

Displayed as expandable chart per instance.

---

## 7. API Design

### GET /api/v1/superadmin/observability/health

#### Response 200 OK
```json
{
  "instances": [
    {
      "instanceId": "uuid",
      "name": "Acme EU Production",
      "type": "on_prem",
      "region": "EU-West",
      "status": "healthy",
      "latencyMs": 142,
      "uptime30d": 99.97,
      "lastHealthAt": "2025-04-25T10:00:00Z",
      "tenantCount": 12,
      "totalUsers": 234
    }
  ],
  "alerts": [
    {
      "instanceId": "uuid",
      "name": "Acme US East",
      "status": "down",
      "message": "No response for 15 minutes",
      "startedAt": "2025-04-25T09:45:00Z"
    }
  ],
  "aggregates": {
    "totalInstances": 4,
    "activeInstances": 4,
    "totalTenants": 142,
    "totalMRR": 28400,
    "totalUsers": 1847,
    "platformUptime30d": 99.94
  }
}
```

### GET /api/v1/superadmin/observability/activity

Same as R1-06 activity log API, but cross-instance fan-out.

#### Query Params: `instanceId`, `eventType`, `severity`, `from`, `to`, `page`, `limit`

### GET /api/v1/superadmin/observability/instances/:instanceId/health-history

#### Query Params: `days` (default: 30)

#### Response 200 OK
```json
{
  "history": [
    {
      "recordedAt": "2025-04-25T10:00:00Z",
      "status": "healthy",
      "latencyMs": 142,
      "errorRate": 0.3,
      "uptime": 99.97
    }
  ]
}
```

---

## 8. Data Model Changes

### New Entity: `instance_health_history`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| instance_id | uuid | FK to `instances` |
| recorded_at | timestamptz | |
| status | varchar | healthy / degraded / down |
| latency_ms | int | |
| error_rate | float | % |
| uptime | float | % uptime in the period |

Retention: 90 days (same as activity log).

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Health history write | Written by health check scheduler (R1-07) | Same job that pings instances writes history |
| Activity fan-out | Same parallel fan-out as R1-08 | Consistent pattern |
| Alert aggregation | Built in superadmin backend from health history | No external alerting system for R1 |

---

## 10. UI/UX Requirements

### Observability Page Layout
```
┌────────────────────────────────────────────────────────────────┐
│ Observability                                                   │
├────────────────────────────────────────────────────────────────┤
│ 🔴 1 Instance Down: Acme US East · No response for 15 min      │
│ [View Instance]  [Retry Health Check]                          │
├────────────────────────────────────────────────────────────────┤
│ 4 Instances  ·  142 Tenants  ·  $28,400 MRR  ·  1,847 Users  │
│ Platform Uptime (30d): 99.94%                                   │
├────────────────────────────────────────────────────────────────┤
│ Instance          │ Type  │ Region │ Health │ Latency │ Uptime │
│ Acme EU Pro       │ OnPre │ EU-W   │ 🟢 OK  │ 142ms   │ 99.97%│
│ DF SaaS EU        │ SaaS  │ EU-W   │ 🟢 OK  │ 23ms    │ 99.99%│
│ Beta Cloud-Manage │ Cloud │ US-E   │ 🟡 Deg │ 890ms   │ 99.12%│
│ Acme US East      │ OnPre │ US-E   │ 🔴 DOWN│ —       │ 97.43%│
├────────────────────────────────────────────────────────────────┤
│ Cross-Instance Activity Stream                                 │
│ [Instance ▼]  [Event Type ▼]  [Severity ▼]  [From]  [To]     │
│ ──────────────────────────────────────────────────────────────  │
│ 🔵 INFO  │ Now       │ DF SaaS EU      │ License.created     │
│ 🔴 ERROR │ 2m ago   │ Acme US East    │ Database connection  │
│ 🔵 INFO  │ 5m ago   │ Acme EU Pro     │ Tenant.suspended    │
└────────────────────────────────────────────────────────────────┘
```

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| Health data | Read-only from instance APIs; no PII |
| Audit | Fan-out queries logged as `observability.health.read` |

---

## 12. Out of Scope

- Automated incident response (Phase 2)
- PagerDuty/OpsGenie integration (Phase 2)
- Real-time WebSocket streaming

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Health history resolution | Every 5 min (4,320 points/month) vs hourly (720 points) | Hourly — sufficient for 30-day charts |
| Alert notification | Email only? PagerDuty? | Email to platform ops team for R1 |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| R1-07 (Instance Registry) | Required | Instance list + health check |
| R1-06 (Observability) | Spec | Activity stream API design |
| R1-08 (Cross-Instance Tenant Portal) | Spec | Fan-out query pattern |

---

## 15. Linked Specs

- **R1-06** (Observability) — Single-instance activity log + system health
- **R1-07** (Instance Registry) — Instance health data source
- **R1-08** (Cross-Instance Tenant Portal) — Fan-out pattern

---

## 16. Verification & Testing

| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Health table: all 4 instances shown | Correct status per instance | E2E |
| TC2 | Down instance → red alert banner | Alert shown at top | E2E |
| TC3 | Activity stream merged from 3 instances | All events sorted by time | E2E |
| TC4 | Filter by instance → only that instance's events | Correct subset | E2E |
| TC5 | Aggregate MRR = sum of all instances | Correct total | Unit |
| TC6 | Instance expand → 30-day uptime chart | Chart renders | Visual |
