# R1-06 — Observability (Activity / System / Audit)

**Spec ID:** R1-06  
**Title:** Super Admin Console — Observability (Activity / System / Audit)  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

Observability covers three distinct but related log streams that give platform operators full visibility into what is happening across the platform:

1. **Platform Activity Log** — all significant application events (tenant signups, subscription changes, license events, user actions)
2. **System Health** — service-level metrics and error tracking (latency, error rates, DB connections, Redis, disk)
3. **Admin Audit Log** — every action taken by a super admin user within the admin console itself

These three streams answer three different questions:
- "What is happening on the platform?" → Activity Log
- "Is the platform healthy?" → System Health
- "What did our admins do?" → Admin Audit Log

---

## 2. Goals

### Activity Log
- [ ] Full event stream: event type, severity, tenant, user, timestamp, details
- [ ] Filters: event type, severity, tenant, user, date range
- [ ] Pagination: 50 events per page
- [ ] Export to CSV
- [ ] Severity badges: INFO (blue), WARNING (amber), ERROR (red)

### System Health
- [ ] Service status list: name, status (healthy/degraded/down), uptime, latency
- [ ] Metrics: API error rate, requests/min, DB connections (current/max), Redis memory, disk usage
- [ ] Deployment info: version, commit, deployed at, deployed by, status
- [ ] Last 50 errors: timestamp, endpoint, HTTP status, error message, user/tenant, stack trace link

### Admin Audit Log
- [ ] All admin actions: admin email, action, target type/ID, details, IP address, timestamp
- [ ] Filters: admin email, action type, date range
- [ ] Immutable log (append-only; no delete or edit)

---

## 3. Non-Goals

- Real-time streaming of activity/events (polling is sufficient for admin UI)
- Automatic alerting on system health degradation (Phase 2 — separate alerting spec)
- Data retention policies beyond 90 days (configurable; not in scope for R1)
- Integration with external SIEM tools (Splunk/Datadog) — Phase 2

---

## 4. User Story

> As a **Platform Operator**,  
> I want to see what is happening across the platform, how healthy the services are, and exactly what my team did in the admin console,  
> so that I can investigate issues, respond to incidents, and maintain accountability.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Activity log shows all event types with correct severity badges | E2E | Various events → correct badge colors |
| AC2 | Activity log filterable by tenant + event type | E2E | Filter "Acme Corp" + "license.created" → correct subset |
| AC3 | System health shows all service statuses | Visual | Services with health dot colors |
| AC4 | Error list shows last 50 errors with stack trace | E2E | Click error → stack trace expandable |
| AC5 | Admin audit log shows all admin actions | E2E | Perform admin action → appears in log |
| AC6 | Audit log entries are immutable (no delete) | Unit | Attempt DELETE on audit endpoint → 405 |
| AC7 | Export activity to CSV | E2E | Click Export → CSV downloaded |

---

## 6. Functional Requirements

### FR-1: Platform Activity Log (`/superadmin/activity`)

Event schema:
| Field | Type | Notes |
|-------|------|-------|
| id | uuid | |
| tenantId | uuid? | Null for platform-level events |
| tenantName | string? | |
| userId | uuid? | |
| userEmail | string? | |
| eventType | enum | `tenant.created`, `tenant.suspended`, `license.created`, `license.expired`, `license.revoked`, `subscription.renewed`, `subscription.canceled`, `user.invited`, `user.deleted`, `login.success`, `login.failed` |
| severity | enum | `INFO` / `WARNING` / `ERROR` |
| details | text | Human-readable summary |
| metadata | jsonb | Additional structured data |
| createdAt | timestamptz | |

Filters: `tenantId`, `eventType`, `userId`, `severity`, `from`, `to`
Pagination: 50 per page
Export: `GET /api/v1/superadmin/activity/export` → CSV download

### FR-2: System Health (`/superadmin/system`)

Service status list:
| Service | Status | Uptime | Latency |
|---------|--------|--------|---------|
| API Server | healthy / degraded / down | 99.97% | 94ms |
| PostgreSQL | healthy / degraded / down | 99.99% | 23ms |
| Redis | healthy / degraded / down | 100% | 1ms |
| SMTP | healthy / degraded / down | — | — |

Status logic:
- `healthy` — latency < 500ms, error rate < 1%
- `degraded` — latency 500ms–2s OR error rate 1–5%
- `down` — latency > 2s OR error rate > 5%

Metrics cards:
- API Error Rate (%)
- API Requests/min
- DB Connections: current / max
- Redis Memory: used MB / max MB
- Disk Usage: used GB / max GB

Deployment info card:
- Version, service name, commit SHA, deployed at, deployed by, status (success/failed)

Error log table (last 50):
| Time | Endpoint | Status | Error | User | Tenant | Stack |
|------|----------|--------|-------|------|--------|-------|

### FR-3: Admin Audit Log (`/superadmin/audit`)

Entry schema:
| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| adminUserId | uuid | |
| adminEmail | string | |
| action | enum | `login`, `settings.update`, `feature_flag.toggle`, `feature_flag.create`, `tenant.suspend`, `tenant.delete`, `license.generate`, `license.revoke`, `license.extend`, `billing.refund`, `billing.change_plan` |
| targetType | string? | e.g. `tenant`, `license`, `feature_flag` |
| targetId | uuid? | |
| details | text? | Human-readable summary |
| oldValue | jsonb? | Previous state (for updates) |
| newValue | jsonb? | New state |
| ipAddress | varchar | |
| createdAt | timestamptz | |

Filters: `adminId`, `action`, `from`, `to`
Pagination: 50 per page

Immutability: No `PUT`, `PATCH`, or `DELETE` endpoints. Audit log is append-only.

---

## 7. API Design

### GET /api/v1/superadmin/activity

#### Query Params
| Param | Type | Notes |
|-------|------|-------|
| `tenantId` | uuid | |
| `eventType` | string | |
| `severity` | `INFO\|WARNING\|ERROR` | |
| `from` | ISO-8601 | |
| `to` | ISO-8601 | |
| `page` | number | Default: 1 |
| `limit` | number | Default: 50, max: 100 |

#### Response 200 OK
```json
{
  "events": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "tenantName": "Acme Corp",
      "userId": "uuid",
      "userEmail": "user@acme.com",
      "eventType": "license.created",
      "severity": "INFO",
      "details": "Professional license generated for Acme Corp",
      "metadata": { "tier": "professional", "validUntil": "2026-01-01" },
      "createdAt": "2025-04-20T10:00:00Z"
    }
  ],
  "total": 2847,
  "page": 1,
  "limit": 50
}
```

### GET /api/v1/superadmin/activity/export

Returns `Content-Type: text/csv` with all events matching filters.

### GET /api/v1/superadmin/system/health

#### Response 200 OK
```json
{
  "services": [
    { "name": "API Server", "status": "healthy", "uptime": "99.97%", "latencyMs": 94 }
  ],
  "metrics": {
    "apiErrorRate": 0.3,
    "apiRequestsPerMin": 847,
    "dbConnections": { "current": 12, "max": 100 },
    "redisMemory": { "used": 45, "max": 256 },
    "diskUsage": { "used": 182, "max": 500 }
  },
  "deployment": {
    "version": "1.4.2",
    "service": "designfoundry-superadmin",
    "commit": "abc1234",
    "deployedAt": "2025-04-20T08:00:00Z",
    "deployedBy": "ci-pipeline",
    "status": "success"
  }
}
```

### GET /api/v1/superadmin/system/errors

#### Query Params: `page`, `limit`

#### Response 200 OK
```json
{
  "errors": [
    {
      "id": "uuid",
      "timestamp": "2025-04-20T10:00:00Z",
      "endpoint": "/api/v1/objects",
      "statusCode": 500,
      "message": "Internal server error",
      "userId": "uuid",
      "tenantId": "uuid",
      "stackTrace": "Error: ...\n  at Object.handle (/app/..."
    }
  ],
  "total": 50
}
```

### GET /api/v1/superadmin/audit

#### Query Params: `adminId`, `action`, `from`, `to`, `page`, `limit`

#### Response 200 OK
```json
{
  "entries": [
    {
      "id": "uuid",
      "adminUserId": "uuid",
      "adminEmail": "super@designfoundry.ai",
      "action": "license.generate",
      "targetType": "license",
      "targetId": "uuid",
      "details": "Generated Professional license for Acme Corp",
      "oldValue": null,
      "newValue": { "tier": "professional", "validUntil": "2026-01-01" },
      "ipAddress": "203.0.113.42",
      "createdAt": "2025-04-20T10:00:00Z"
    }
  ],
  "total": 421,
  "page": 1,
  "limit": 50
}
```

---

## 8. Data Model Changes

### New Entity: `platform_activity_log`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | FK, nullable |
| user_id | uuid | FK, nullable |
| event_type | varchar | |
| severity | varchar | INFO/WARNING/ERROR |
| details | text | |
| metadata | jsonb | |
| created_at | timestamptz | Indexed; retention 90 days |

### New Entity: `system_errors`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| timestamp | timestamptz | |
| endpoint | varchar | |
| status_code | int | |
| message | text | |
| user_id | uuid | FK, nullable |
| tenant_id | uuid | FK, nullable |
| stack_trace | text | |
| created_at | timestamptz | Indexed |

### New Entity: `admin_audit_log`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| admin_user_id | uuid | |
| admin_email | varchar | |
| action | varchar | |
| target_type | varchar | Nullable |
| target_id | uuid | Nullable |
| details | text | Nullable |
| old_value | jsonb | Nullable |
| new_value | jsonb | Nullable |
| ip_address | varchar | |
| created_at | timestamptz | Immutable; no updated_at |

*No migration needed for audit log — this table is owned entirely by the superadmin app.*

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Log retention | 90 days for activity/error logs | Keeps DB size manageable; audit log is permanent |
| Log ingestion | Events emitted via MQTT to superadmin app | Main app publishes to MQTT; superadmin subscribes and writes |
| Error collection | `apiErrors` table populated by NestJS interceptor | All unhandled 5xx errors caught by global interceptor |
| Audit log writer | Middleware intercepts all admin API responses | Audit middleware writes entry after successful responses |
| Health checks | `/health` endpoint on each service | Superadmin polls all registered services |

### MQTT Activity Event Flow
```
Main app emits event
        ↓
MQTT topic: `platform/activity`
        ↓
Superadmin MQTT subscriber
        ↓
Writes to `platform_activity_log` table
```

### Admin Audit Middleware
```typescript
@Injectable()
export class AdminAuditMiddleware implements NestMiddleware {
  use(req, res, next) {
    const originalEnd = res.end;
    res.end = function(...args) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // write audit log entry
      }
      return originalEnd.apply(this, args);
    };
    next();
  }
}
```

---

## 10. UI/UX Requirements

### Activity Log Page
```
┌──────────────────────────────────────────────────────────────────────┐
│ Activity Log                              [Export CSV] [↺ Refresh] │
├──────────────────────────────────────────────────────────────────────┤
│ [Event Type ▼]  [Severity ▼]  [Tenant ▼]  [From]  [To]            │
├──────────────────────────────────────────────────────────────────────┤
│ 🔵 INFO │ Apr 20 10:00 │ Acme Corp     │ user@acme.com │ License.. │
│ 🔵 INFO │ Apr 20 09:55 │ Beta Corp     │               │ Tenant .. │
│ 🟡 WARN │ Apr 20 09:30 │              │               │ API err.. │
│ 🔴 ERROR│ Apr 20 09:28 │ Gamma Corp   │               │ DB con.. │
├──────────────────────────────────────────────────────────────────────┤
│ [Show 50 more]                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### System Health Page
```
┌──────────────────────────────────────────────────────────────────────┐
│ System Health                                                     │
├──────────────────────────────────────────────────────────────────────┤
│ 🟢 API Server     99.97% uptime    94ms                             │
│ 🟢 PostgreSQL     99.99% uptime    23ms                             │
│ 🟢 Redis          100%  uptime     1ms                              │
├──────────────────────────────────────────────────────────────────────┤
│ API Error Rate: 0.3%      Requests/min: 847                        │
│ DB Connections: 12/100     Redis Memory: 45/256 MB                │
├──────────────────────────────────────────────────────────────────────┤
│ Deployment: v1.4.2 · commit abc1234 · deployed Apr 20 08:00       │
├──────────────────────────────────────────────────────────────────────┤
│ Last 50 Errors                                                    │
│ Time            │ Endpoint         │ Status │ Error                │
│ Apr 20 10:00   │ /api/v1/objects  │ 500    │ Internal error [▶]   │
└──────────────────────────────────────────────────────────────────────┘
```

### Admin Audit Log Page
```
┌──────────────────────────────────────────────────────────────────────┐
│ Admin Audit Log                                    [Export CSV]     │
├──────────────────────────────────────────────────────────────────────┤
│ [Admin ▼]  [Action ▼]  [From]  [To]                                  │
├──────────────────────────────────────────────────────────────────────┤
│ super@designfoundry.ai │ license.generate │ Apr 20 10:00 │ 203.0.x.x │
│ super@designfoundry.ai │ settings.update │ Apr 20 09:30 │ 203.0.x.x │
├──────────────────────────────────────────────────────────────────────┤
│ Showing 1-50 of 421          [<] Page 1 of 9 [>]                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| Audit log integrity | Append-only; no update/delete endpoints |
| IP address logging | Stored for all admin actions |
| Sensitive data in logs | Metadata scrubbed of PII before logging |
| GDPR | Activity logs are operational; if they contain EU user data, apply 90-day retention |

---

## 12. Out of Scope

- Real-time event streaming (WebSocket)
- External SIEM integration (Phase 2)
- Automatic alerting (Phase 2 — PagerDuty/OpsGenie integration)
- Data retention configuration UI

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Activity log retention | 30 / 60 / 90 days | 90 days for R1 |
| MQTT vs HTTP for events | MQTT push vs HTTP polling | MQTT for real-time; fallback to HTTP polling if broker down |
| Error stack traces | Store full stack? | Yes in dev/staging; truncate to 500 chars in production |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| MQTT broker | External | Platform events via MQTT |
| All other R1 specs | Spec | Activity log entries come from all modules |

---

## 15. Linked Specs

- **R1-01** (Overview Dashboard) — Uses system health API for status banner
- **R1-02** (Tenant Management) — Activity tab uses activity log API
- **R1-04** (License Management) — License events in activity log
- **R1-03** (Billing) — Billing events in activity log

---

## 16. Verification & Testing

### Test Cases
| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Activity log loads with pagination | First 50 events shown | E2E |
| TC2 | Filter by "license.created" | Only license events shown | E2E |
| TC3 | Export activity to CSV | Valid CSV with all matching rows | E2E |
| TC4 | System health shows correct service statuses | All services with correct status | Visual |
| TC5 | Error log expandable | Stack trace shows on expand | E2E |
| TC6 | Admin action → audit log entry | Action in log with correct metadata | Unit |
| TC7 | Attempt DELETE on audit endpoint | 405 Method Not Allowed | Unit |
