# R1-10 — Tenant Content Pack Management

**Spec ID:** R1-10  
**Title:** Tenant Content Pack Management  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

Tenant Content Pack Management gives super admins the ability to view, enable, and disable content packs per tenant from the super admin console. Content packs (defined in S074) bundle object types, diagram types, notation rules, viewpoints, reports, and template diagrams for specific frameworks (ArchiMate, BPMN, TOGAF) or industries (Healthcare, Financial Services).

This spec covers the super admin's interface for managing which packs are active for each tenant — including viewing pack status, enabling/disabling packs, assigning custom packs, and viewing per-tenant license constraints on packs.

---

## 2. Goals

- [ ] **Per-Tenant Pack List** — show all available packs and their activation state for a specific tenant
- [ ] **Enable / Disable Pack** — toggle a pack on or off for a tenant; activation runs pack migration
- [ ] **License Constraint Indicator** — show which packs are gated by license feature keys (S073); block enable if tenant lacks license
- [ ] **Built-in Packs Status** — always-on packs (Core) shown as enabled and non-toggleable
- [ ] **Custom Pack Assignment** — assign a custom content pack to a specific tenant
- [ ] **What's Included** — show pack contents (object types, diagram types, reports count) in an expander

---

## 3. Non-Goals

- Content pack creation/editing (done by content pack developers in the main app or via JSON upload)
- Uploading new pack definitions from the superadmin (admin uploads happen in the main app)
- Per-user pack visibility (tenant-level activation only; per-user is Phase 2)
- Pack upgrade management (upgrading pack versions is Phase 2)

---

## 4. User Story

> As a **Platform Operator**,  
> I want to enable ArchiMate for a specific enterprise tenant who has the corresponding license add-on,  
> so that their architects can use ArchiMate notation without affecting any other tenant.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Tenant pack list shows all available packs with status | E2E | Tenant → Content Packs → all packs listed |
| AC2 | Enable pack → tenant can now use pack's types | E2E | Enable ArchiMate → new ArchiMate types selectable |
| AC3 | Disable pack → pack's types hidden; existing objects stay | E2E | Disable BPMN → BPMN types hidden; BPMN objects still in DB |
| AC4 | License-gated pack blocked with message | E2E | No ArchiMate license → enable → 403 + "License required" |
| AC5 | Core pack shown as always-enabled | Visual | Core pack has no toggle; shown as enabled |
| AC6 | "What's included" expander shows pack contents | Visual | Expand ArchiMate → object type list shown |
| AC7 | Pack change logged to audit | Unit | Enable pack → audit log entry exists |

---

## 6. Functional Requirements

### FR-1: Per-Tenant Pack List (`/superadmin/tenants/:id/content-packs`)

Table columns: Pack Name · Version · Type · Status · License Required · Actions

Status badges:
- 🟢 **Enabled** — toggle on (green)
- ⚪ **Disabled** — toggle off (gray)
- 🔒 **License Required** — toggle off but not license-gated (lock icon)

Types: `builtin` (ArchiMate, BPMN, TOGAF, Core) · `custom` · `marketplace`

Row actions: Enable / Disable (toggle switch)

### FR-2: Pack Activation Toggle

Toggle flow:
1. Admin clicks toggle → optimistic UI update
2. `POST /api/v1/superadmin/tenants/:id/content-packs/:packId/activate` or `/deactivate`
3. Backend checks license for gated packs → `403` if not licensed
4. If SaaS: emit MQTT event `tenant/:id/packs/activate` or `.../deactivate`
5. If successful: migration runs (seeds new type configs)
6. Audit log entry created
7. On failure: revert UI + error toast

### FR-3: License Constraint Indicator

Packs that require a license feature key show a lock badge:
- Pack row: "🔒 License Required" badge
- Toggle tooltip: "Requires ArchiMate Pack license add-on"
- Clicking toggle shows confirmation modal with license requirement notice
- If tenant lacks the required license add-on: toggle disabled + "License Required" badge

### FR-4: What's Included Expander

Each pack row has an expand button → reveals:
- Object types count + list
- Diagram types count + list
- Report/view templates count
- Notation rules summary

Data from pack manifest (fetched from instance or cached).

### FR-5: Custom Pack Assignment

Admin can assign a custom pack to a tenant:
1. From pack list, click "Assign Custom Pack"
2. Select from list of available custom packs (created in main app)
3. `POST /api/v1/superadmin/tenants/:id/content-packs/custom/:packId/assign`
4. Pack activation migration runs
5. Audit log entry

---

## 7. API Design

### GET /api/v1/superadmin/tenants/:tenantId/content-packs

#### Response 200 OK
```json
{
  "packs": [
    {
      "id": "archimate-3.2",
      "name": "ArchiMate 3.2",
      "version": "3.2.1",
      "type": "builtin",
      "enabled": true,
      "licenseRequired": true,
      "licenseFeatureKey": "archimate-pack",
      "tenantHasLicense": true,
      "objectTypesCount": 62,
      "diagramTypesCount": 4,
      "reportsCount": 3
    },
    {
      "id": "bpmn-2.0",
      "name": "BPMN 2.0",
      "version": "2.0.1",
      "type": "builtin",
      "enabled": false,
      "licenseRequired": true,
      "licenseFeatureKey": "bpmn-pack",
      "tenantHasLicense": false,
      "objectTypesCount": 54,
      "diagramTypesCount": 2,
      "reportsCount": 2
    }
  ],
  "customPacks": [
    {
      "id": "custom-acme-taxonomy",
      "name": "Acme Internal Taxonomy",
      "version": "1.0.0",
      "type": "custom",
      "enabled": false
    }
  ]
}
```

### POST /api/v1/superadmin/tenants/:tenantId/content-packs/:packId/activate

#### Response 200 OK
```json
{ "status": "enabled", "activatedAt": "2025-04-25T10:00:00Z" }
```

### POST /api/v1/superadmin/tenants/:tenantId/content-packs/:packId/deactivate

#### Response 200 OK

### GET /api/v1/superadmin/content-packs/:packId/manifest

Returns the full pack manifest (used for "What's Included" expander).

---

## 8. Data Model Changes

No new entities. Pack state per tenant is stored on the respective instance's DB. Superadmin app reads and writes via the instance's own API (via connection pool from R1-07).

### New Entity: `tenant_content_pack_state` (on instance DB)
| Column | Type | Notes |
|--------|------|-------|
| tenant_id | uuid | FK |
| pack_id | varchar | |
| enabled | boolean | |
| activated_at | timestamptz | |
| deactivated_at | timestamptz | |
| activated_by | uuid | Admin user |

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pack state storage | Instance DB (not superadmin DB) | Pack state lives with the tenant's instance; superadmin API proxies |
| License check | Superadmin backend checks license via S073 before enabling | Prevents UI toggle showing success when license is missing |
| Pack manifest | Fetched from instance's API or cached in superadmin | Avoid storing pack definitions in superadmin |
| Migration | Runs asynchronously on instance after pack activation | Don't block admin UI waiting for migration |

### Pack Activation Flow (Cross-Instance)
```
Admin clicks Enable on ArchiMate for Acme EU tenant
        ↓
Superadmin: POST /instances/:id/tenants/:id/content-packs/:packId/activate
        ↓
Instance backend: check license → run activation migration → emit event
        ↓
MQTT: tenant/:id/packs/activated
        ↓
Superadmin: log to audit
```

---

## 10. UI/UX Requirements

### Per-Tenant Content Packs Page (`/superadmin/tenants/:id/content-packs`)
```
┌────────────────────────────────────────────────────────────────────────┐
│ Acme Corp — Content Packs                     [Assign Custom Pack]    │
├────────────────────────────────────────────────────────────────────────┤
│ Pack Name       │ Version │ Type   │ Status    │ License  │ Actions │
│ ──────────────────────────────────────────────────────────────────── │
│ DesignFoundry   │ 1.0.0   │ Core   │ 🟢 Always │ —        │ —       │
│ ArchiMate 3.2   │ 3.2.1   │Builtin │ 🟢 Enabled│ 🔒 Key   │ [Toggle]│
│ BPMN 2.0        │ 2.0.1   │Builtin │ ⚪Disabled │ 🔒 Key   │ [Toggle]│
│ TOGAF           │ 1.0.0   │Builtin │ ⚪Disabled │ —        │ [Toggle]│
├────────────────────────────────────────────────────────────────────────┤
│ [▶] ArchiMate 3.2 — What's Included                                  │
│   Object types: 62 (Application Component, Business Function, ...) │
│   Diagram types: 4 (ArchiMate, ArchiMate Layered, ...)              │
│   Reports: 3 (Application Landscape, Technology Landscape, ...)     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| License gate | Backend enforces license check; not just UI hiding |
| Pack toggle audit | All enable/disable actions logged to `admin_audit_log` |
| Custom pack security | Custom packs uploaded in main app are validated against schema before activation |

---

## 12. Out of Scope

- Pack creation/editing (main app)
- Per-user pack visibility within a tenant
- Pack version upgrades (Phase 2)

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Pack manifest caching | Cache in superadmin? TTL? | Cache 1 hour; invalidate on pack update |
| Activation migration time | Show progress indicator? | Async; poll for completion |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| S074 (Content Pack System) | Required | Pack schema + activation logic |
| S073 (Unified License Architecture) | Required | License feature key checking |
| R1-07 (Instance Registry) | Required | Cross-instance API proxying |

---

## 15. Linked Specs

- **S074** (Content Pack System) — Defines packs, activation, and license tie-in
- **S073** (Unified License Architecture) — License feature keys for pack access
- **R1-02** (Tenant Management) — Content Packs tab in tenant detail
- **R1-11** (Global Content Pack Registry) — Global registry + admin pack management

---

## 16. Verification & Testing

| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Pack list shows all available packs | 4 packs listed (Core, ArchiMate, BPMN, TOGAF) | E2E |
| TC2 | Enable ArchiMate → enabled | Toggle → pack status = enabled | E2E |
| TC3 | Disable BPMN → objects remain in DB | Disable → existing BPMN objects still queryable | Integration |
| TC4 | Enable without license → blocked | No ArchiMate license → 403 + error message | E2E |
| TC5 | "What's included" shows pack contents | Expand → object type list shown | E2E |
| TC6 | Audit log entry on toggle | Enable → query audit log → entry exists | Unit |
