# R1-05 — Platform Settings & Feature Flags

**Spec ID:** R1-05  
**Title:** Super Admin Console — Platform Settings & Feature Flags  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

Platform Settings is the administrative control panel for global platform configuration: brand identity (name, logo, support URLs), registration and trial policies, email sender configuration, and feature flags that gate functionality across the entire platform.

Feature flags give the platform team the ability to enable/disable capabilities (new UI features, beta features, compliance modules) without requiring code deployments. Each flag is scoped to either the entire platform or specific deployments.

---

## 2. Goals

- [ ] **Platform Settings** — platform name, support email, support URL, default tenant plan, registration enabled toggle, trial enabled toggle
- [ ] **Email Configuration** — SMTP sender (host, port, user, password, from address), send test email
- [ ] **Feature Flags** — list all flags with current value + default; toggle individual flags
- [ ] **Flag Scope** — platform-wide flags vs per-deployment flags
- [ ] **Audit Log** — all flag changes logged (who, what, when, old value, new value)

---

## 3. Non-Goals

- Per-tenant feature flags (tenant-level gating is license-based, not flag-based)
- Feature flag targeting rules (e.g., % rollout, user segment) — Phase 2
- Automated rollback of flags after time period — Phase 2
- Email template management (separate Email Templates spec)

---

## 4. User Story

> As a **Platform Operator**,  
> I want to control platform-wide settings and feature flags from one place,  
> so that I can configure branding, open/close registration, manage trials, and toggle features without touching code or configuration files.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Settings page shows all platform settings | Visual | All fields populated with current values |
| AC2 | Update platform name → persisted + shown on next load | E2E | Change name → refresh → new name shown |
| AC3 | Toggle registration enabled → affects new signups | E2E | Disable → attempt signup → blocked |
| AC4 | Configure SMTP → test email sent successfully | Manual | Fill SMTP fields → Send Test → email received |
| AC5 | Feature flags list shows all flags | E2E | All flags listed with enabled/disabled state |
| AC6 | Toggle feature flag → new value persisted | E2E | Toggle flag → refresh → new state shown |
| AC7 | Flag change creates audit log entry | Unit | Toggle flag → query audit log → entry exists |
| AC8 | Toggle platform-wide flag → affects all deployments | Integration | Toggle → check across deployments → propagated |

---

## 6. Functional Requirements

### FR-1: Platform Settings Form

Fields:
| Field | Type | Notes |
|-------|------|-------|
| Platform Name | Text | e.g. "DesignFoundry" |
| Support Email | Email | Shown in UI and emails |
| Support URL | URL | Link in help menus |
| Default Tenant Plan | Select | Free / Team |
| Registration Enabled | Toggle | Blocks new tenant signups |
| Trial Enabled | Toggle | Enables 14-day trial flow |

On save: `PATCH /api/v1/superadmin/settings` → validates → persists → returns updated settings

### FR-2: Email Configuration

SMTP settings section:
| Field | Type | Notes |
|-------|------|-------|
| SMTP Host | Text | e.g. `smtp.postmarkapp.com` |
| SMTP Port | Number | 25, 587, or 465 |
| SMTP User | Text | |
| SMTP Password | Password (masked) | Stored encrypted; shown as masked dots |
| From Address | Email | Sender for transactional emails |
| Use TLS | Toggle | |

"Send Test Email" button:
1. Input: recipient email address
2. `POST /api/v1/superadmin/settings/test-email` with SMTP config + recipient
3. Sends test email via configured SMTP
4. Success/failure toast with error message if failed

### FR-3: Feature Flags List

Table columns: Flag Key · Description · Scope · Default · Current · Actions

Scope: `platform` (all deployments) or `deployment:<id>` (specific instance)

Toggle action: switch component per row → `PATCH /api/v1/superadmin/settings/feature-flags/:key`

When toggled:
1. Optimistic UI update (toggle immediately)
2. API call: `PATCH /api/v1/superadmin/settings/feature-flags/:key` with `{ enabled: bool }`
3. On failure: revert UI + show error toast
4. Audit log entry created

### FR-4: Add New Feature Flag

Admin can add a new flag from the UI:
- Flag key (kebab-case, must be unique)
- Description
- Scope (platform / specific deployment)
- Default value (enabled / disabled)
- On create: insert into DB; flag immediately available

### FR-5: Audit Log Integration

All settings changes and feature flag toggles logged to `admin_audit_log`:
- `action`: `settings.update`, `feature_flag.toggle`, `feature_flag.create`
- `details`: JSON with old value → new value diff

---

## 7. API Design

### GET /api/v1/superadmin/settings

**Auth:** Required

#### Response 200 OK
```json
{
  "platformName": "DesignFoundry",
  "supportEmail": "support@designfoundry.ai",
  "supportUrl": "https://docs.designfoundry.ai",
  "defaultTenantPlan": "team",
  "registrationEnabled": true,
  "trialEnabled": true,
  "emailConfig": {
    "smtpHost": "smtp.postmarkapp.com",
    "smtpPort": 587,
    "smtpUser": "support@designfoundry.ai",
    "fromAddress": "DesignFoundry <noreply@designfoundry.ai>",
    "useTls": true
  }
}
```

### PATCH /api/v1/superadmin/settings

**Auth:** Required

#### Request
```json
{
  "platformName": "DesignFoundry Pro",
  "supportEmail": "pro@designfoundry.ai",
  "registrationEnabled": false
}
```

#### Response 200 OK
Updated settings object. `smtpPassword` never returned (only masked).

### PATCH /api/v1/superadmin/settings/smtp-password

**Auth:** Required

#### Request
```json
{ "smtpPassword": "new-password-here" }
```

#### Response 200 OK
`{ "status": "updated" }` — password stored encrypted.

### GET /api/v1/superadmin/settings/feature-flags

#### Response 200 OK
```json
{
  "flags": [
    {
      "key": "ai-assistant",
      "description": "Enable AI Assistant in the diagram canvas",
      "scope": "platform",
      "defaultEnabled": false,
      "enabled": true,
      "updatedAt": "2025-04-20T10:00:00Z",
      "updatedBy": "admin@designfoundry.ai"
    }
  ]
}
```

### PATCH /api/v1/superadmin/settings/feature-flags/:key

#### Request
```json
{ "enabled": true }
```

#### Response 200 OK
Updated flag object.

### POST /api/v1/superadmin/settings/feature-flags

#### Request
```json
{
  "key": "new-feature",
  "description": "Description of the feature",
  "scope": "platform",
  "enabled": false
}
```

#### Response 201 Created

### POST /api/v1/superadmin/settings/test-email

#### Request
```json
{
  "recipient": "test@example.com"
}
```

#### Response 200 OK
```json
{ "sent": true }
```
or
```json
{ "sent": false, "error": "SMTP connection refused" }
```

---

## 8. Data Model Changes

### New Entity: `platform_settings`
| Column | Type | Notes |
|--------|------|-------|
| key | varchar | PK |
| value | jsonb | Stores all settings; not normalized |
| updated_at | timestamptz | |
| updated_by | uuid | Admin user |

*Alternative (normalized):*
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| setting_key | varchar | UNIQUE |
| setting_value | text | Encrypted for secrets |
| updated_at | timestamptz | |
| updated_by | uuid | Admin user |

### New Entity: `feature_flags`
| Column | Type | Notes |
|--------|------|-------|
| key | varchar | PK |
| description | text | |
| scope | varchar | `platform` or `deployment:<uuid>` |
| default_enabled | boolean | |
| enabled | boolean | Current value |
| created_at | timestamptz | |
| created_by | uuid | Admin user |
| updated_at | timestamptz | |
| updated_by | uuid | Admin user who last changed |

### Existing Entity Changes: `admin_audit_log`
| Column | Type | Notes |
|--------|------|-------|
| old_value | jsonb | Previous flag/settings value |
| new_value | jsonb | New flag/settings value |

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Settings storage | DB (normalized `platform_settings` table) | Consistent with other superadmin data; no env file reload needed |
| SMTP password | Encrypted at rest (AES-256-GCM) | Never stored in plain text |
| Flag storage | DB `feature_flags` table | Fast read; cached in Redis for main app reads |
| Flag propagation | Main app re-reads from DB on next request (or Redis TTL 30s) | No push needed; lazy propagation |
| Test email | Calls internal `MailerService.send()` directly | Bypasses external API for testing |

### Flag Propagation to Main App
```
Superadmin toggles flag
        ↓
feature_flags.updated_at updated
        ↓
Main app (on next request or via Redis pub/sub)
        ↓
Reads fresh flag value from DB
        ↓
Applies to request pipeline
```

---

## 10. UI/UX Requirements

### Settings Page Layout (`/superadmin/settings`)
```
┌──────────────────────────────────────────────────────────────────┐
│ Settings                                                         │
├──────────────────────────────────────────────────────────────────┤
│ ┌─ Platform ──────────────────────────────────────────────────┐  │
│ │ Platform Name    [DesignFoundry            ]               │  │
│ │ Support Email    [support@designfoundry.ai ]               │  │
│ │ Support URL      [https://docs.designfoundry.ai]            │  │
│ │ Default Plan     [Team ▼]                                   │  │
│ │ Registration     [●────○ Enabled ]                          │  │
│ │ Trials           [●────○ Enabled ]                          │  │
│ └─────────────────────────────────────────────────────────────┘  │
│                                                                │
│ ┌─ Email (SMTP) ─────────────────────────────────────────────┐  │
│ │ SMTP Host      [smtp.postmarkapp.com       ]               │  │
│ │ SMTP Port      [587                         ]              │  │
│ │ SMTP User      [support@designfoundry.ai    ]              │  │
│ │ SMTP Password  [••••••••••••••             ] [Update]     │  │
│ │ From Address   [DesignFoundry <noreply@...>]               │  │
│ │ Use TLS        [●────○ Enabled ]                            │  │
│ │                              [Send Test Email]              │  │
│ └─────────────────────────────────────────────────────────────┘  │
│                                                                │
│                              [Save Changes]                    │
└──────────────────────────────────────────────────────────────────┘
```

### Feature Flags Section
```
┌─ Feature Flags ────────────────────────────────────────────────┐
│ [+ Add Flag]                               [Platform ▼] [All] │
│ ────────────────────────────────────────────────────────────── │
│ Key              │ Description           │ Default │ Current │
│ ai-assistant     │ AI Assistant in canvas│  OFF    │ [●──○] │
│ bpmn-editor      │ BPMN Diagram Editor   │  OFF    │ [○──●] │
│ export-pdf-pro   │ Pro PDF Export        │  OFF    │ [●──○] │
│ compliance-reports│ Compliance Reports  │  OFF    │ [○──○] │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| SMTP password | Stored encrypted; never returned in API responses |
| Flag changes | All logged with admin ID + old/new values |
| Registration toggle | Audited; also notify tenant on disable |
| SMTP credentials | Stored separately from platform settings; encrypted at rest |

---

## 12. Out of Scope

- Per-tenant feature flags (license-driven)
- Flag targeting rules / % rollouts (Phase 2)
- Auto-rollback timers on flags (Phase 2)
- Email template management

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Flag defaults | Hardcoded in app or stored in DB? | DB: `default_enabled` column |
| Main app flag read | Redis cache or direct DB? | Redis with 30s TTL; DB as source of truth |
| SMTP password update | Require old password? | No; admin confirmed access already |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| `platform_settings` table | DB | Superadmin-owned |
| `feature_flags` table | DB | Superadmin-owned |
| R1-06 (Observability) | Spec | Audit log for settings changes |

---

## 15. Linked Specs

- **R1-06** (Observability) — Audit log integration
- **R1-07** (Instance Registry) — Per-deployment flag scoping
- **S073** (Unified License Architecture) — Feature flags related to license add-ons

---

## 16. Verification & Testing

### Test Cases
| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Update platform name → saved | GET settings → new name | E2E |
| TC2 | Disable registration → blocked | New signup → 403 | E2E |
| TC3 | Update SMTP → test email sent | Test email received | Manual |
| TC4 | Toggle flag on → persisted | Refresh → flag still enabled | E2E |
| TC5 | Toggle flag off → propagated to main app | Next request sees flag disabled | Integration |
| TC6 | Create new flag → appears in list | POST → GET → flag present | E2E |
| TC7 | Flag change → audit log entry | Toggle → audit log → entry with old/new | Unit |
| TC8 | SMTP password never returned in GET | GET settings → no password field | Unit |
