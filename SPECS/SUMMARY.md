# Super Admin Console — Feature Specification Summary

**Generated:** 2026-04-25  
**Updated:** 2026-04-25  
**Root:** `designfoundry-ea-superadmin` repo  
**Backlog Ref:** P10-superadmin

---

## Total: 14 Feature Specs (13 new + 1 retrospective)

| Release | Spec Count | Focus |
|---------|------------|-------|
| R0 — Already Built | 1 | Retrospective — current scaffold state |
| R1 — MVP | 13 | All superadmin features |

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ Complete | Implemented and verified against spec |
| 🔄 In Progress | Active implementation underway |
| 🟡 Partial | Core functionality exists; spec requirements not formally verified |
| ⬜ Not Started | No implementation exists |

---

## R0 — Already Built (Retrospective)

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| R0-00 | Super Admin Console — Current Scaffold | P1 | 🟡 Partial | Next.js 15 scaffold, API client, login flow, sidebar nav, overview dashboard UI, all route directories created |

---

## R1 Specs (12) — Release 1 MVP

### Group 1: Core Console Pages (R1-01 through R1-06)

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| R1-01 | Overview Dashboard | P1 | ⬜ Not Started | KPI cards, MRR/ARR charts, system status banner, activity feed |
| R1-02 | Tenant Management | P1 | ⬜ Not Started | List/filter/suspend/delete tenants; per-tenant detail tabs |
| R1-03 | Billing & Subscriptions | P1 | ⬜ Not Started | Stripe customer view, invoices, refunds, failed payment retry |
| R1-04 | License Management | P1 | ⬜ Not Started | Generate/revoke/extend signed licenses; RSA via KMS; .lic download |
| R1-05 | Platform Settings & Feature Flags | P1 | ⬜ Not Started | Email config, branding, feature toggles |
| R1-06 | Observability (Activity / System / Audit) | P1 | ⬜ Not Started | Activity log, system health, admin audit log |

### Group 2: Multi-Instance Management (R1-07 through R1-09)

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| R1-07 | Instance Registry | P1 | ⬜ Not Started | Register SaaS/cloud/on-prem instances; encrypted connection strings |
| R1-08 | Cross-Instance Tenant Portal | P1 | ⬜ Not Started | All tenants across all instances; per-tenant overview with richer stats |
| R1-09 | Cross-Instance Observability | P1 | ⬜ Not Started | Aggregate health, MRR, and activity across all deployments |

### Group 3: Content & AI Management (R1-10 through R1-12)

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| R1-10 | Tenant Content Pack Management | P1 | ⬜ Not Started | Per-tenant content pack enable/disable/configure |
| R1-11 | Global Content Pack Registry | P1 | ⬜ Not Started | Global registry: install/add/remove/update content packs |
| R1-12 | AI Models Registry (Admin) | P1 | ⬜ Not Started | Subscription AI models management; BYOAI separate |

### Group 4: Instance Provisioning (R1-13)

| ID | Title | Priority | Status | Notes |
|----|-------|----------|--------|-------|
| R1-13 | Instance Provisioning & Onboarding | P1 | ⬜ Not Started | Onboard new on-prem/cloud managed instances from admin console |

---

## Spec Status Snapshot

- **R0-00**: 🟡 Partial — scaffold exists; backend and real pages not yet built
- **R1-01 through R1-13**: ⬜ Not Started — all spec'd, not yet implemented

---

## File Structure

```
SPECS/
├── SUMMARY.md         ← this file
├── TEMPLATE.md        ← spec authoring template
├── archive/           ← obsolete/superseded specs
│   └── P01-00-super-admin-console-original.md  ← original S070 (migrated from rezonator/S070)
├── R0/                ← 1 retrospective spec (what's already built)
└── R1/                ← 12 MVP specs (R1-01 through R1-13)
```
