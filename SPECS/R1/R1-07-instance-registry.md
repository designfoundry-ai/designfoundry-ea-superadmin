# R1-07 — Instance Registry

**Spec ID:** R1-07  
**Title:** Instance Registry — Multi-Deployment Management  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

The Instance Registry is the foundation for all multi-deployment management. It maintains a curated list of every DesignFoundry deployment (SaaS, cloud-managed, on-prem) with their metadata, connection details, and operational status. All subsequent cross-instance features (tenant portal, observability) build on top of this registry.

Each registered instance is a self-contained DesignFoundry stack: its own PostgreSQL database, NestJS backend, and Next.js frontend. They operate autonomously — an instance continues to function even if the super admin console is unreachable. The super admin console connects to instances on demand for administrative queries.

---

## 2. Goals

- [ ] **Instance Registry** — list all known deployments with metadata
- [ ] **Add Instance** — register a new on-prem or cloud-managed deployment
- [ ] **Instance Health** — periodic health check (latency, status) per registered instance
- [ ] **Encrypted Connection Strings** — database credentials stored AES-256-GCM encrypted
- [ ] **Per-Instance Connection Pool** — lazy connections when querying cross-instance data
- [ ] **Edit/Deactivate Instance** — update metadata, deactivate (soft-remove) an instance
- [ ] **Deployment Type** — SaaS (managed by us) vs Cloud-Managed (customer-managed cloud) vs On-Prem (customer-hosted)
- [ ] **Instance Detail** — version, region, last health check, tenant count, user count

---

## 3. Non-Goals

- Active-active replication between deployments (each is independent write master)
- Load balancing or traffic routing between deployments
- Schema migrations across deployments (each runs its own migrations)
- Real-time WebSocket monitoring (polling acceptable)
- Automatic instance discovery (manual registration only for R1)

---

## 4. User Story

> As a **Platform Operator**,  
> I want to register and manage all DesignFoundry deployments from one console,  
> so that I can monitor their health, connect to their databases, and provision tenants in the correct region.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Instance list shows all registered instances | E2E | All instances displayed with type, region, status |
| AC2 | Add new on-prem instance → connection test passes | E2E | Fill form → test connection → success → instance saved |
| AC3 | Encrypted credentials never stored in plain text | Unit | DB check → credentials field is encrypted blob |
| AC4 | Instance health check runs on schedule | Integration | Health check job → instance status updated |
| AC5 | Deactivate instance → removed from active list | E2E | Deactivate → instance not shown in active list |
| AC6 | Instance detail shows all metadata | Visual | Instance detail → version, region, tenant/user counts |
| AC7 | SaaS instance marked as managed; on-prem as customer-managed | Visual | Badge shows "SaaS" / "Cloud-Managed" / "On-Prem" |

---

## 6. Functional Requirements

### FR-1: Instance List (`/superadmin/instances`)

Table columns: Name · Type · Region · Version · Status · Health · Tenants · Last Check · Actions

Instance types:
| Type | Badge | Description |
|------|-------|-------------|
| `saas` | 🟢 SaaS | DesignFoundry-hosted, managed by us |
| `cloud_managed` | 🔵 Cloud-Managed | Customer's cloud account (AWS/GCP/Azure) |
| `on_prem` | ⚪ On-Prem | Customer-hosted, bare metal or VM |

Status: `active` / `inactive` / `deactivated`

Health: `healthy` / `degraded` / `down` / `unknown`

Actions: View Detail · Edit · Health Check Now · Deactivate

### FR-2: Add Instance Form

Fields:
| Field | Type | Notes |
|-------|------|-------|
| Instance Name | Text | e.g. "Acme EU Production" |
| Deployment Type | Radio | SaaS / Cloud-Managed / On-Prem |
| Base URL | URL | Instance frontend URL (used for health check) |
| API URL | URL | Backend API URL |
| Database Host | Text | e.g. `db.acme.internal` |
| Database Port | Number | Default: 5432 |
| Database Name | Text | |
| Database User | Text | |
| Database Password | Password | Stored encrypted |
| Region | Select | EU-West / EU-Central / US-East / APAC-Singapore |
| Instance Version | Text | e.g. `1.4.2` |
| Notes | Textarea | Internal notes |

Connection test: On submit, attempt to connect to DB and ping API URL before saving.

### FR-3: Encrypted Credentials Storage

Database credentials stored in `instances.credentials` (AES-256-GCM encrypted JSON blob).

Encryption key from GCP Secret Manager (`INSTANCE_CREDENTIALS_ENCRYPTION_KEY`).

```
credentials blob = AES-256-GCM encrypt({
  dbHost, dbPort, dbName, dbUser, dbPassword
})
```

### FR-4: Health Check Scheduler

Every 5 minutes: ping each instance's `/health` endpoint + measure latency.

Update `instances.last_health_at`, `instances.health_status`, `instances.latency_ms`.

If 3 consecutive failures: mark as `down` + send internal alert.

### FR-5: Instance Detail (`/superadmin/instances/:id`)

Header: Instance name · Type badge · Region · Status badge

Sections:
- **Overview**: Version, deployment date, last health check, API URL, Base URL
- **Database**: Host (masked), port, database name (read-only)
- **Usage**: Tenant count, total users, total objects (queried from instance DB on demand)
- **Recent Events**: Last 10 health events (upgraded/downgraded/errors)

Actions: Edit · Trigger Health Check · Deactivate

### FR-6: Edit/Deactivate Instance

Edit: Same form as Add; pre-populated with current values.

Deactivate:
- Confirmation modal: "This will remove the instance from active monitoring. Tenants on this instance are not affected."
- On confirm: `status = deactivated`; instance hidden from active list
- Can be re-activated later

---

## 7. API Design

### GET /api/v1/superadmin/instances

#### Response 200 OK
```json
{
  "instances": [
    {
      "id": "uuid",
      "name": "Acme EU Production",
      "type": "on_prem",
      "region": "EU-West",
      "baseUrl": "https://acme.designfoundry.ai",
      "apiUrl": "https://acme-api.designfoundry.ai",
      "version": "1.4.2",
      "status": "active",
      "healthStatus": "healthy",
      "latencyMs": 142,
      "lastHealthAt": "2025-04-25T10:00:00Z",
      "tenantCount": 12,
      "userCount": 234,
      "createdAt": "2024-06-01T00:00:00Z"
    }
  ],
  "total": 5
}
```

### POST /api/v1/superadmin/instances

#### Request
```json
{
  "name": "Acme EU Production",
  "type": "on_prem",
  "baseUrl": "https://acme.designfoundry.ai",
  "apiUrl": "https://acme-api.designfoundry.ai",
  "region": "EU-West",
  "credentials": {
    "dbHost": "db.acme.internal",
    "dbPort": 5432,
    "dbName": "designfoundry",
    "dbUser": "df_reader",
    "dbPassword": "secret"
  },
  "notes": "Customer-managed AWS deployment"
}
```

#### Response 201 Created
```json
{ "id": "uuid", "status": "active", "healthStatus": "unknown" }
```

### PATCH /api/v1/superadmin/instances/:id

### POST /api/v1/superadmin/instances/:id/health-check

Triggers immediate health check; returns updated health status.

### POST /api/v1/superadmin/instances/:id/deactivate

#### Response 200 OK

---

## 8. Data Model Changes

### New Entity: `instances`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | varchar | |
| type | varchar | saas / cloud_managed / on_prem |
| base_url | varchar | |
| api_url | varchar | |
| region | varchar | |
| version | varchar | |
| credentials | text | AES-256-GCM encrypted JSON blob |
| notes | text | |
| status | varchar | active / inactive / deactivated |
| health_status | varchar | healthy / degraded / down / unknown |
| latency_ms | int | |
| last_health_at | timestamptz | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Existing Entity Changes: `tenants`
| Change | Notes |
|--------|-------|
| + `instance_id` (uuid) | FK to `instances.id` — which deployment this tenant belongs to |

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Connection pool | Lazy (connect on demand) | Don't hold open connections to all instances permanently |
| Health check | HTTP GET to `/health` endpoint | Lightweight; every instance exposes this |
| DB access | Direct PG connection per instance | For cross-instance queries (tenant stats); use connection pooler |
| Encryption key | GCP Secret Manager | Rotation possible; key never in code |
| Multi-region | Instances registered manually | No auto-discovery for R1 |

### Connection Pool Per Instance
```typescript
const pools = new Map<string, Pool>();

function getPool(instanceId: string): Pool {
  if (!pools.has(instanceId)) {
    const inst = await getInstance(instanceId);
    const creds = decryptCredentials(inst.credentials);
    pools.set(instanceId, new Pool({
      host: creds.dbHost,
      port: creds.dbPort,
      database: creds.dbName,
      user: creds.dbUser,
      password: creds.dbPassword,
    }));
  }
  return pools.get(instanceId);
}
```

---

## 10. UI/UX Requirements

### Instance List
```
┌────────────────────────────────────────────────────────────────────────┐
│ Instances                                      [+ Add Instance]          │
├────────────────────────────────────────────────────────────────────────┤
│ Name              │ Type           │ Region   │ Health │ Tenants │ ···  │
│ DF SaaS EU        │ 🟢 SaaS       │ EU-West  │ 🟢 OK  │ 130     │ ···  │
│ Acme Production   │ ⚪ On-Prem     │ EU-West  │ 🟢 OK  │ 12      │ ···  │
│ Beta Cloud-Managed│ 🔵 Cloud-Manag│ US-East  │ 🟡 Deg │ 3       │ ···  │
└────────────────────────────────────────────────────────────────────────┘
```

### Instance Detail
```
┌─────────────────────────────────────────────────────────────┐
│ ← Back to Instances                                        │
│                                                            │
│ Acme EU Production              [Edit] [Health Check] [×]  │
│ ⚪ On-Prem · EU-West · Active                               │
├─────────────────────────────────────────────────────────────┤
│ Base URL: https://acme.designfoundry.ai                    │
│ API URL:  https://acme-api.designfoundry.ai                │
│ Version:  v1.4.2                                           │
│ Last Health: Apr 25 10:00 · 🟢 142ms                       │
│                                                            │
│ Tenants: 12        Users: 234       Objects: 14,823        │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| DB credentials | AES-256-GCM encrypted at rest; key in GCP Secret Manager |
| On-prem credentials | Never transmitted to third parties; encrypted blob stored only in superadmin DB |
| Network isolation | On-prem instances use private IPs/VPN; credentials never in logs |
| Instance deactivation | Soft deactivation; data retained; can be re-activated |

---

## 12. Out of Scope

- Automatic instance discovery (Phase 2)
- Cross-deployment write transactions
- Federation of authentication across instances

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Health check frequency | 1 min / 5 min / 15 min | 5 min — balance between visibility and load |
| SaaS instance registration | Auto-register or manual? | Manual for all for auditability |
| DB credential rotation | Support rotate without downtime? | Phase 2 |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| GCP Secret Manager | External | `INSTANCE_CREDENTIALS_ENCRYPTION_KEY` |
| R1-08 (Cross-Instance Tenant Portal) | Spec | Uses instance list for dropdown |
| R1-09 (Cross-Instance Observability) | Spec | Uses instance registry for health aggregation |

---

## 15. Linked Specs

- **R1-08** (Cross-Instance Tenant Portal) — Instance filter dropdown; cross-instance tenant list
- **R1-09** (Cross-Instance Observability) — Aggregate health view across all instances
- **R1-13** (Instance Provisioning) — Instance onboarding flow builds on registry

---

## 16. Verification & Testing

### Test Cases
| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | List all instances | All instances shown with correct types | E2E |
| TC2 | Add new on-prem instance | Instance in list with "unknown" health | E2E |
| TC3 | Credentials stored encrypted | DB raw value != plain text | Unit |
| TC4 | Health check runs → status updated | After check → health status updated | Integration |
| TC5 | 3 consecutive failures → marked down | Health status = down | Integration |
| TC6 | Deactivate instance → hidden from active list | Status = deactivated; not in active list | E2E |
| TC7 | Connection test fails → form shows error | Error message; instance not saved | E2E |
