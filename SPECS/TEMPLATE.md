# Spec Authoring Template

Use this template for every spec. Copy it when creating a new spec.
Fill every section — do not leave placeholders unmarked.

---

# {SPEC_ID} — {Feature Name}

**Spec ID:** {ID}  
**Title:** {Feature name}  
**Release:** {R1/R2/R3/R4}  
**Priority:** {P0/P1/P2/P3}  
**Status:** Draft  
**Created:** 2026-04-14  
**Updated:** 2026-04-14  
**Spec Owner:** {owner or TBD}  
**Backlog Ref:** {backlog item IDs, e.g. P0-12, P1-27}

---

## 1. Feature Overview
*What this feature does, who it serves, and why it matters commercially or technically.*

## 2. Goals
- [ ] *Goal 1 — specific, measurable outcome*
- [ ] *Goal 2*

## 3. Non-Goals
*What this feature explicitly does NOT do. These are as important as the goals — they prevent scope creep.*

## 4. User Story
> As a **[persona]** (Enterprise Architect / CIO / Solution Architect / CTO / Application Owner),  
> I want to **[perform specific action]**,  
> so that **[I achieve a specific business or technical outcome]**.

## 5. Acceptance Criteria

| ID | Criterion | Verification Method | Test Scenario |
|----|-----------|---------------------|---------------|
| AC1 | *Criterion is a concrete, testable statement* | *Unit test / integration test / manual test / inspection* | *Specific scenario that exercises this criterion* |
| AC2 | | | |

## 6. Functional Requirements

### FR-1: *Requirement Name*
*Description: what the system must do, in precise terms.*

### FR-2: *Requirement Name*
*Description.*

## 7. API Design

### Endpoint
`METHOD /api/v1/{resource}`

**Auth:** Required (JWT Bearer token)

#### Request
```json
{
  // request body — include all fields with types
}
```

#### Response 200 OK
```json
{
  // success response body
}
```

#### Error Responses
| Code | Condition | Body |
|------|-----------|------|
| 400 | Validation failure | `{ "error": "message", "field": "fieldName" }` |
| 401 | Not authenticated | `{ "error": "Unauthorized" }` |
| 403 | Not authorized | `{ "error": "Forbidden" }` |
| 404 | Resource not found | `{ "error": "Not found" }` |

## 8. Data Model Changes

### New Entity: *EntityName*
*If this spec introduces new database entities.*

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | N | gen_random_uuid() | Primary key |
| *col* | *type* | *Y/N* | *default* | *notes* |

### Existing Entity Changes: *EntityName*
*If modifying an existing entity (e.g., ArchitectureObject).*

| Change | Before | After |
|--------|--------|-------|
| *column* | *old* | *new* |

### Migration Notes
*Schema migration approach, backward compatibility, zero-downtime strategy.*

## 9. Architecture / Implementation Notes

### Technical Approach
*The key libraries, patterns, and architectural decisions.*

### Key Decisions to Resolve
| Decision | Options | Recommendation |
|----------|---------|-----------------|
| *Decision* | *A vs B vs C* | *Recommendation* |

## 10. UI/UX Requirements

### Key Screens
| Screen | Purpose | Key Interactions |
|--------|---------|-----------------|
| */route* | *What it does* | *Click X → Y* |

### User Flow
*Step-by-step flow describing how a user interacts with this feature.*

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| Authentication | *How auth is handled for this feature* |
| Authorization | *RBAC / object-level permissions* |
| Data residency | *GDPR / EU data rules* |
| Regulatory | *DORA / NIS2 / GDPR implications* |

## 12. Out of Scope
*Explicitly excluded items — prevents feature creep.*

## 13. Open Questions
*Unresolved decisions, dependencies on other work, ambiguities to clarify.*

## 14. Dependencies
| Dependency | Type | Notes |
|------------|------|-------|
| *Spec SXXX* | Required | *Why* |
| *External library* | Required | *Version or compatibility* |

## 15. Linked Specs
- *SXXX* — Related because *reason*
- *SXXX* — Blocked by *reason*

## 16. Verification & Testing

### Test Cases
| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | *Scenario* | *Result* | *Unit/Integration/E2E* |
| TC2 | | | |

### Test Data Requirements
*Any specific test data needed to verify this feature.*