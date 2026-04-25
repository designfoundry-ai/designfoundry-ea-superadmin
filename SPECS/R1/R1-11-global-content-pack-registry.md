# R1-11 — Global Content Pack Registry

**Spec ID:** R1-11  
**Title:** Global Content Pack Registry (Admin)  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

The Global Content Pack Registry is the admin-side interface for managing the full catalog of content packs available across all DesignFoundry instances. It allows platform operators to install new packs (builtin and custom), view and update pack versions, remove packs from the catalog, and manage marketplace listings.

This spec covers the super admin's view and management of the pack registry — separate from the per-tenant pack management in R1-10, which handles activation for specific tenants. R1-11 is about the catalog itself: what packs exist, what versions are available, and how they're distributed to instances.

---

## 2. Goals

- [ ] **Pack Catalog** — list all packs in the registry: built-in (ArchiMate, BPMN, TOGAF, Core) + custom + marketplace
- [ ] **View Pack Detail** — full manifest, version history, object type count, diagram type count
- [ ] **Install / Add Pack** — add a new pack to the registry (upload JSON manifest for custom packs)
- [ ] **Update Pack** — upload new version of an existing pack (version bump)
- [ ] **Remove Pack from Catalog** — soft-remove a pack (marks as deprecated; doesn't delete existing objects)
- [ ] **Pack Distribution** — mark which instances a pack is available on
- [ ] **Marketplace Listing** — toggle a pack as marketplace-visible (public or private)

---

## 3. Non-Goals

- Creating a content pack from scratch (pack definition is done by a content developer; admin uploads the manifest)
- Per-user pack visibility within a tenant
- Billing for marketplace packs (Phase 2 — tied to Stripe)
- Pack approval workflow for community submissions (Phase 2)

---

## 4. User Story

> As a **Platform Operator**,  
> I want to manage the pack registry — adding custom packs, updating versions, and controlling which packs are available on which instances —  
> so that I can extend the platform's modeling capabilities without code deployments and control the pack catalog across all deployments.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Pack catalog lists all packs with metadata | E2E | All packs shown with name, version, type, instance availability |
| AC2 | Add custom pack → appears in catalog | E2E | Upload manifest JSON → pack in list with type=custom |
| AC3 | Update pack version → version history updated | E2E | Upload new version → version incremented; history entry added |
| AC4 | Remove pack → marked deprecated; not deleted | E2E | Remove → pack shows deprecated badge; existing objects still accessible |
| AC5 | Pack distribution toggle per instance | E2E | Uncheck "DF SaaS EU" → pack not available on that instance |
| AC6 | Marketplace visibility toggle | E2E | Toggle marketplace → pack visible/hidden in tenant UI marketplace tab |
| AC7 | Version history view shows all past versions | Visual | Pack detail → version history → list of all versions |

---

## 6. Functional Requirements

### FR-1: Pack Catalog (`/superadmin/content-packs`)

Table columns: Pack Name · ID · Version · Type · Instances Available · Marketplace · Status · Actions

Types: `builtin` · `custom` · `marketplace`

Status: `active` · `deprecated` · `draft`

Actions: View Detail · Edit · Update Version · Remove

Filters: type, status, marketplace, search by name

### FR-2: Pack Detail View (`/superadmin/content-packs/:id`)

Header: Pack name · ID · Type badge · Status badge · Marketplace toggle

Sections:

**Overview** — Author, license, description, total object types, diagram types, reports

**Version History** — Table of all versions: version number · date · changelog · installed count

**Object Types** — List of all object types in the pack with source attribution

**Diagram Types** — List of diagram types

**Instance Availability** — List of all instances with checkboxes:
- Checked = pack available on that instance
- Toggle → `PATCH /api/v1/superadmin/content-packs/:id/instances/:instanceId`

**Marketplace** — Toggle: Public / Private (with note: "Public packs visible to all tenants")

### FR-3: Add Pack (Install)

Upload form:
1. Pack ID (auto-generated or manual; must be unique)
2. Pack name
3. Type: Built-in / Custom / Marketplace
4. Version
5. JSON manifest file (drag-and-drop or file picker)
6. Target instances (multi-select which instances to make this pack available on)

Validation: Validate manifest against Content Pack JSON schema (S074 FR-1).

On submit: store manifest in DB; make available on selected instances.

### FR-4: Update Pack (Version Bump)

1. Select existing pack
2. Upload new manifest file (JSON)
3. Version number must be higher than current
4. Changelog text (required)
5. On submit: new version stored; version history entry added

### FR-5: Remove Pack from Catalog

Soft removal:
1. Admin clicks "Remove" → confirmation modal
2. Note: "This will mark the pack as deprecated. Existing activated copies on tenants will continue to work."
3. On confirm: `status = deprecated`; `deprecated_at = now`
4. Pack no longer shown in active catalog (can filter to show deprecated)
5. Existing objects using pack types remain fully accessible

### FR-6: Marketplace Listing Management

Admin can toggle a pack's marketplace visibility:
- **Public** — visible in tenant's Settings > Content Packs marketplace tab
- **Private** — not visible to tenants; only directly assigned packs shown

---

## 7. API Design

### GET /api/v1/superadmin/content-packs

#### Query Params: `type`, `status`, `marketplace`, `search`, `page`, `limit`

#### Response 200 OK
```json
{
  "packs": [
    {
      "id": "archimate-3.2",
      "name": "ArchiMate 3.2",
      "version": "3.2.1",
      "type": "builtin",
      "status": "active",
      "marketplace": "public",
      "instancesAvailable": 4,
      "objectTypesCount": 62,
      "diagramTypesCount": 4,
      "reportsCount": 3,
      "createdAt": "2024-01-15T00:00:00Z"
    }
  ],
  "total": 6
}
```

### GET /api/v1/superadmin/content-packs/:id

#### Response 200 OK
```json
{
  "id": "archimate-3.2",
  "name": "ArchiMate 3.2",
  "version": "3.2.1",
  "type": "builtin",
  "author": "The Open Group",
  "licenseFeatureKey": "archimate-pack",
  "description": "...",
  "status": "active",
  "marketplace": "public",
  "objectTypes": [...],
  "diagramTypes": [...],
  "versionHistory": [
    { "version": "3.2.1", "date": "2025-01-15", "changelog": "..." },
    { "version": "3.2.0", "date": "2024-06-01", "changelog": "..." }
  ]
}
```

### POST /api/v1/superadmin/content-packs

#### Request
```json
{
  "id": "custom-acme-taxonomy",
  "name": "Acme Internal Taxonomy",
  "type": "custom",
  "version": "1.0.0",
  "manifest": { /* full Content Pack JSON manifest */ },
  "instanceIds": ["uuid", "uuid"]
}
```

#### Response 201 Created

### PATCH /api/v1/superadmin/content-packs/:id/instances/:instanceId

#### Request
```json
{ "available": false }
```

#### Response 200 OK

### POST /api/v1/superadmin/content-packs/:id/deprecate

Soft-removes the pack from the catalog.

---

## 8. Data Model Changes

### New Entity: `content_packs` (superadmin-owned registry)
| Column | Type | Notes |
|--------|------|-------|
| id | varchar | PK (e.g. `archimate-3.2`) |
| name | varchar | |
| type | varchar | builtin / custom / marketplace |
| current_version | varchar | |
| manifest | jsonb | Full pack manifest |
| status | varchar | active / deprecated / draft |
| marketplace | varchar | public / private |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### New Entity: `content_pack_versions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| pack_id | varchar | FK to `content_packs.id` |
| version | varchar | |
| manifest | jsonb | Full pack manifest at this version |
| changelog | text | |
| created_at | timestamptz | |
| created_by | uuid | Admin user |

### New Entity: `content_pack_instance_availability`
| Column | Type | Notes |
|--------|------|-------|
| pack_id | varchar | FK |
| instance_id | uuid | FK to `instances.id` |
| available | boolean | |

*This table lives in the superadmin DB (registry), not on individual instances.*

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pack manifest storage | JSONB in superadmin DB | Fast read; schema validated on upload |
| Instance distribution | Superadmin DB tracks which pack is on which instance | Registry is the source of truth |
| Pack activation | Instance DB has its own `tenant_content_pack_state` (R1-10) | Each instance manages its own activation state |
| Pack manifest validation | JSON Schema (S074 FR-1) | Ensure all required fields present before storing |
| Version history | Immutable append-only | Never overwrite; always add new version row |

---

## 10. UI/UX Requirements

### Pack Catalog Page
```
┌────────────────────────────────────────────────────────────────────────┐
│ Content Pack Registry                           [+ Add Pack]          │
├────────────────────────────────────────────────────────────────────────┤
│ [Type ▼]  [Status ▼]  [Marketplace ▼]  [🔍 Search...]                │
├────────────────────────────────────────────────────────────────────────┤
│ Pack Name          │ ID                   │ Ver  │ Type │ Mktpl │ ···  │
│ ────────────────────────────────────────────────────────────────────  │
│ DesignFoundry Core │ designfoundry-core  │ 1.0  │ Core │ —     │ ···  │
│ ArchiMate 3.2      │ archimate-3.2       │ 3.2  │ Built│ Public│ ···  │
│ BPMN 2.0           │ bpmn-2.0            │ 2.0  │ Built│ Public│ ···  │
│ Acme Taxonomy      │ custom-acme-taxonomy │ 1.0  │ Custo│ Private│ ··· │
└────────────────────────────────────────────────────────────────────────┘
```

### Pack Detail Layout
```
┌─────────────────────────────────────────────────────────────┐
│ ← Back to Content Packs                                    │
│                                                             │
│ ArchiMate 3.2                     [Edit] [Update] [Remove] │
│ archimate-3.2 · builtin · 🟢 Active · 🔓 Marketplace Public │
├─────────────────────────────────────────────────────────────┤
│ Overview ────────────────────────────────────────────────────│
│ Author: The Open Group                                      │
│ License Feature Key: archimate-pack                         │
│ Object Types: 62 · Diagram Types: 4 · Reports: 3           │
│                                                             │
│ Version History ────────────────────────────────────────────│
│ 3.2.1 · 2025-01-15 · Added 4 new element types              │
│ 3.2.0 · 2024-06-01 · Initial release                        │
│                                                             │
│ Instance Availability ───────────────────────────────────────│
│ ☑ DF SaaS EU  ☑ Acme EU Production  ☐ Beta Cloud-Managed   │
│                                                             │
│ Object Types (62) ───────────────────────────────────────────│
│ Application Component · Application Interface · ...         │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| Pack manifest validation | JSON schema validation before storage; reject malformed manifests |
| Marketplace visibility | Only explicitly public packs shown to tenants |
| Pack removal | Soft deprecation; existing tenant objects unaffected |
| Audit | All add/update/remove actions logged with admin ID |

---

## 12. Out of Scope

- Pack creation (JSON authoring done by content developers)
- Marketplace billing (Phase 2)
- Community pack approval workflow
- Per-user pack visibility within a tenant

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Pack upload size limit | 1MB / 5MB / 10MB | 5MB — manifest files are JSON, not large |
| Pack dependencies | Allow packs to depend on other packs? | No for R1; Phase 2 |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| S074 (Content Pack System) | Required | JSON manifest schema |
| R1-07 (Instance Registry) | Required | Instance list for distribution toggles |
| R1-10 (Tenant Content Pack Management) | Spec | Per-tenant activation builds on this registry |

---

## 15. Linked Specs

- **S074** (Content Pack System) — Pack manifest schema; defines all pack fields
- **R1-10** (Tenant Content Pack Management) — Per-tenant pack activation (builds on this registry)
- **R1-07** (Instance Registry) — Instance availability toggles

---

## 16. Verification & Testing

| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Pack catalog shows all 6 packs | Correct list with metadata | E2E |
| TC2 | Upload custom pack manifest → pack appears in list | Pack with type=custom shown | E2E |
| TC3 | Update version → version history shows new entry | Two entries in version history | E2E |
| TC4 | Remove pack → marked deprecated | Pack status = deprecated; deprecated badge | E2E |
| TC5 | Uncheck instance → pack not available there | Instance unchecked; not in availability | E2E |
| TC6 | Marketplace toggle → tenant sees pack | Toggle public → pack visible in tenant marketplace | E2E |
| TC7 | Invalid manifest JSON → validation error | Upload bad JSON → 400 + error message | Unit |
