# R1-13 — Instance Provisioning & Onboarding

**Spec ID:** R1-13  
**Title:** Instance Provisioning & Onboarding  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

Instance Provisioning is the workflow for onboarding a new DesignFoundry deployment — whether cloud-managed or on-prem — from the superadmin console. It covers the end-to-end process of registering a new instance (capturing credentials), running deployment readiness checks, and making the instance operational within the platform's registry.

This spec covers the super admin's interface for provisioning workflows. Actual infrastructure provisioning (spinning up VMs, Kubernetes clusters, databases) is handled externally; this spec focuses on the admin UI that orchestrates the connection and registration process.

---

## 2. Goals

- [ ] **Instance Provisioning Wizard** — multi-step form for registering a new deployment
- [ ] **Deployment Type Selection** — Cloud-Managed (AWS/GCP/Azure) vs On-Prem (bare metal/VM)
- [ ] **Connection Configuration** — database credentials, API URL, health check setup
- [ ] **Readiness Checks** — verify DB connection, API reachability, schema version, license key presence
- [ ] **Instance Registration** — save to instance registry (R1-07) upon successful provisioning
- [ ] **Provisioning Status Tracking** — step-by-step progress indicator during onboarding
- [ ] **Provisioning Log** — step-by-step log of what was verified during provisioning

---

## 3. Non-Goals

- Actual infrastructure provisioning (VM creation, Kubernetes deployment, database setup) — handled by external IaC tooling (Terraform, Helm)
- Automated TLS certificate provisioning (handled by cert-manager or external tooling)
- Multi-region deployment creation (one instance at a time for R1)
- One-click automated deployment (Phase 2)

---

## 4. User Story

> As a **Platform Operator**,  
> I want to register and connect a new on-prem customer deployment from the admin console,  
> so that I can verify the instance is correctly configured, add it to the registry, and start managing it — all from one place.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Provisioning wizard has 4 steps | Visual | Steps: Configure → Verify → Register → Complete |
| AC2 | DB connection test → success/failure shown | E2E | Correct credentials → green checkmark; wrong → red error |
| AC3 | API reachability test → version + health shown | E2E | Valid API URL → instance version displayed |
| AC4 | Schema version check → shows if DB schema is current | E2E | Schema version mismatch → warning shown |
| AC5 | Failed check → provisioning blocked | E2E | DB connection fails → Next step disabled |
| AC6 | Successful provisioning → instance in registry | E2E | Complete → instance visible in registry |
| AC7 | Provisioning log shows step-by-step results | Visual | Each check → log entry with pass/fail + details |

---

## 6. Functional Requirements

### FR-1: Provisioning Wizard

Multi-step wizard with 4 steps:

**Step 1: Deployment Type & Basics**
| Field | Type | Notes |
|-------|------|-------|
| Instance Name | Text | Internal name (e.g. "Acme EU Production") |
| Deployment Type | Radio | Cloud-Managed / On-Prem |
| Target Cloud | Conditional | AWS / GCP / Azure (shown if Cloud-Managed) |
| Region | Select | EU-West / EU-Central / US-East / APAC |
| Base URL | URL | Frontend URL |
| API URL | URL | Backend API URL |

**Step 2: Database Configuration**
| Field | Type | Notes |
|-------|------|-------|
| Database Host | Text | |
| Database Port | Number | Default: 5432 |
| Database Name | Text | |
| Database User | Text | |
| Database Password | Password | |

**Step 3: Connection Verification** (runs automatically on entry)
Checks run in sequence:
1. **Database Connection** — Connect to PostgreSQL → query `SELECT version()`
2. **Schema Version** — Query `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1` → compare to expected
3. **API Reachability** — `GET /health` on API URL → check response
4. **License Key Presence** — Query `SELECT * FROM licenses WHERE tenant_id IS NULL LIMIT 1` → check if platform license exists
5. **Keycloak/Auth Reachability** — `GET /realms/{realm}/.well-known/openid-configuration` → check auth system

Each check shows: status icon (✅/❌/⏳) + message + duration

**Step 4: Review & Register**
Summary of all entered data + readiness check results.
"Register Instance" button → save to instance registry.

### FR-2: Readiness Check Execution

Checks run asynchronously on Step 3 entry. UI shows live progress.

Check schema:
```json
{
  "checks": [
    {
      "id": "db_connection",
      "name": "Database Connection",
      "status": "passed",
      "durationMs": 234,
      "message": "Connected to PostgreSQL 15.4",
      "details": {}
    },
    {
      "id": "api_reachability",
      "name": "API Reachability",
      "status": "passed",
      "durationMs": 89,
      "message": "API responding: v1.4.2",
      "details": { "version": "1.4.2" }
    },
    {
      "id": "schema_version",
      "name": "Schema Version",
      "status": "warning",
      "durationMs": 45,
      "message": "Schema v1.4.1; expected v1.4.2",
      "details": { "current": "1.4.1", "expected": "1.4.2" }
    }
  ]
}
```

### FR-3: Provisioning Log

Append-only log of all checks and their outputs stored in `instance_provisioning_logs`:
| Field | Type | Notes |
|-------|------|-------|
| instance_id | uuid | FK |
| step | varchar | configure / verify / register |
| check_id | varchar | |
| status | passed / failed / warning / skipped |
| duration_ms | int | |
| message | text | |
| details | jsonb | Raw check output |
| created_at | timestamptz | |

### FR-4: On-Prem Provisioning Checklist

For On-Prem deployments, show a pre-flight checklist:
- [ ] Database provisioned and accessible
- [ ] DesignFoundry backend installed and running
- [ ] Frontend deployed and accessible
- [ ] License key generated in superadmin (links to R1-04)
- [ ] SMTP configured for transactional emails
- [ ] Keycloak / auth system configured

These are informational checkboxes — admin marks them manually. They serve as a confirmation that the customer has completed their side of the setup before the superadmin registers the instance.

---

## 7. API Design

### POST /api/v1/superadmin/instances/provision/verify

Takes connection config (DB + API); runs all readiness checks; returns results.

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
  }
}
```

#### Response 200 OK
```json
{
  "checks": [
    {
      "id": "db_connection",
      "name": "Database Connection",
      "status": "passed",
      "durationMs": 234,
      "message": "Connected to PostgreSQL 15.4"
    }
  ],
  "allPassed": false,
  "warningsCount": 1,
  "failuresCount": 0
}
```

### POST /api/v1/superadmin/instances/provision/register

On successful verification, registers the instance in the registry.

#### Request
```json
{
  "name": "Acme EU Production",
  "type": "on_prem",
  "baseUrl": "https://acme.designfoundry.ai",
  "apiUrl": "https://acme-api.designfoundry.ai",
  "region": "EU-West",
  "credentials": { ... },
  "verificationResults": { ... }
}
```

#### Response 201 Created
```json
{ "id": "uuid", "status": "active", "healthStatus": "unknown" }
```

---

## 8. Data Model Changes

No new core entities. Uses `instances` table from R1-07. Provisioning log is a new entity.

### New Entity: `instance_provisioning_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| instance_id | uuid | FK to `instances.id`; nullable until registered |
| session_id | uuid | Groups checks from one provisioning run |
| step | varchar | configure / verify / register |
| check_id | varchar | |
| status | varchar | passed / failed / warning / skipped |
| duration_ms | int | |
| message | text | |
| details | jsonb | |
| created_at | timestamptz | |

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Verification execution | Superadmin backend connects directly to instance DB/API | Centralized; admin has credentials |
| Check timeout | 30 seconds per check | Don't hang on unreachable hosts |
| Parallel checks | Run DB + API checks in parallel; schema check after DB succeeds | Speed up execution |
| Credentials handling | Passed in request body; encrypted at rest (same as R1-07) | Never logged; stored encrypted |

---

## 10. UI/UX Requirements

### Provisioning Wizard Layout
```
┌────────────────────────────────────────────────────────────────┐
│ Provision New Instance                                          │
├────────────────────────────────────────────────────────────────┤
│ Step indicator:  ① Configure → ② Verify → ③ Review → ④ Done  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Step 1 of 4: Deployment Type & Basics                         │
│  ──────────────────────────────────────────                    │
│  Instance Name: [Acme EU Production        ]                  │
│  Type:        (●) On-Prem  ( ) Cloud-Managed                  │
│  Region:      [EU-West ▼]                                      │
│  Base URL:    [https://acme.designfoundry.ai]                 │
│  API URL:     [https://acme-api.designfoundry.ai]             │
│                                                        [Next →]│
└────────────────────────────────────────────────────────────────┘
```

### Step 3 — Verification (Live Progress)
```
┌────────────────────────────────────────────────────────────────┐
│ Step 3 of 4: Connection Verification                          │
├────────────────────────────────────────────────────────────────┤
│ ⏳ Database Connection          running...                    │
│ ✅ API Reachability              passed · 89ms · v1.4.2       │
│ ⚠ Schema Version                warning · expected v1.4.2     │
│ ⏳ Auth System                   pending...                    │
│                                                                │
│ [← Back]                                        [Register →]  │
│ (Disabled until all critical checks pass)                     │
└────────────────────────────────────────────────────────────────┘
```

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| DB credentials | Passed in request; encrypted at rest immediately after verification |
| Check output | Never logged to stdout; stored in `instance_provisioning_logs` only |
| Provisioning access | Only `role=superadmin` can run provisioning |
| On-prem security | Customer's private network credentials never transmitted beyond superadmin-to-instance |

---

## 12. Out of Scope

- Actual VM/container provisioning (Terraform/Helm handles infrastructure)
- TLS certificate automation (cert-manager / external CA)
- Automated database migration (customer must run migrations before provisioning)
- Multi-region cluster setup

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Schema version compatibility | Allow provisioning with older schema? | Yes with warning; migration note shown |
| Provisioning rollback | If registration fails midway? | Transaction rollback; no partial registration |
| Customer self-service provisioning | Allow customers to run their own checks? | Phase 2 — customer-facing onboarding wizard |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| R1-07 (Instance Registry) | Required | Registers instance; uses same credentials storage |
| R1-04 (License Management) | Spec | On-prem requires license generation before provisioning |
| S073 (Unified License Architecture) | External | Platform license required for on-prem |

---

## 15. Linked Specs

- **R1-07** (Instance Registry) — Instance storage; credentials encryption
- **R1-04** (License Management) — License key required before registration
- **R1-08** (Cross-Instance Tenant Portal) — Newly registered instance immediately shows in tenant portal

---

## 16. Verification & Testing

| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Provisioning wizard navigates through 4 steps | Steps advance correctly | E2E |
| TC2 | Correct DB credentials → connection passed | Green checkmark; version shown | E2E |
| TC3 | Wrong DB credentials → connection failed | Red X; error message shown | E2E |
| TC4 | Schema version mismatch → warning shown | Amber warning; not blocking | E2E |
| TC5 | All critical checks pass → Register button enabled | Button enabled | E2E |
| TC6 | Complete → instance in registry | Instance visible in list with correct data | E2E |
| TC7 | Provisioning log stored | Check log DB → all entries present | Unit |
