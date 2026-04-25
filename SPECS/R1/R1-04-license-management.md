# R1-04 — License Management

**Spec ID:** R1-04  
**Title:** Super Admin Console — License Management  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin  

---

## 1. Feature Overview

License Management is the administrative interface for generating, viewing, revoking, and extending RSA-signed JWT licenses that govern tenant access to DesignFoundry features and limits. It is the admin-side counterpart to the license architecture defined in the platform's `S073` specification.

Every tenant has exactly one active license JWT at any time. The super admin app is the sole issuer of licenses — the RSA private key never lives in the main application. The license encodes: tier, object/user limits, active add-ons, validity window, hardware binding, and revocation status.

---

## 2. Goals

- [ ] **License List** — all licenses across all tenants: tenant name, tier, status, validity window, limits usage
- [ ] **License Generator** — generate a new signed license JWT for a tenant with configurable parameters
- [ ] **Per-Tenant License View** — full license payload, current usage vs limits, hardware binding status
- [ ] **Revoke License** — invalidate a license immediately (for abuse/cancellation)
- [ ] **Extend License** — add months to the validity window without changing other parameters
- [ ] **Download `.lic` File** — export the raw license file for on-prem delivery
- [ ] **License Status Badges** — Active (green) / Expiring (amber, < 30 days) / Expired (red) / Revoked (slate)
- [ ] **Stripe Webhook Handler** — `POST /webhooks/stripe` creates/extends licenses on successful payment

---

## 3. Non-Goals

- Automatic license renewal (Stripe subscription renewal triggers webhook → new license; no cron needed)
- License generation without an associated tenant (every license must have a `tenantId`)
- Editing individual license fields post-generation (revoke + re-generate instead)
- Hardware binding configuration (handled in the main app; shown read-only here)

---

## 4. User Story

> As a **Platform Operator**,  
> I want to generate and manage signed licenses for all tenants,  
> so that I can enforce feature tiers, control object/user limits, and revoke access immediately when needed.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | License list shows all licenses with correct status | E2E | License list → each row shows status badge |
| AC2 | Generate license → signed JWT created and stored | Unit | Fill form → submit → license in DB + JWT returned |
| AC3 | Generated license passes verification in main app | Integration | Generate → copy to main app → license valid |
| AC4 | Revoke license → license immediately invalid | E2E | Revoke → license status = Revoked → main app rejects |
| AC5 | Extend license → validity window extended | E2E | Extend 12 months → validUntil = +12 months |
| AC6 | Download `.lic` file → valid license file | Unit | Download → open → content is valid JWT |
| AC7 | Stripe webhook `invoice.paid` → new license created | Integration | Simulate webhook → license created for tenant |
| AC8 | License approaching expiry (< 30 days) → amber badge | E2E | Create license expiring in 20 days → amber badge |
| AC9 | Revocation checked on every license validation | Unit | Revoked license → validation returns `revoked` |

---

## 6. Functional Requirements

### FR-1: License List (`/superadmin/licenses`)

Table columns: Tenant · Plan/Tier · Status · Issued · Expires · Objects (used/limit) · Users (used/limit) · Add-Ons · Actions

Filters: status (active/expiring/expired/revoked), tier, instance, expiry range, search by tenant name

Status logic:
- `active` — `validUntil > now + 30 days`
- `expiring` — `now < validUntil <= now + 30 days`
- `expired` — `validUntil <= now`
- `revoked` — `revoked_at IS NOT NULL`

Actions: View · Revoke · Extend · Download

### FR-2: License Generator (`/superadmin/licenses/new`)

Form fields:
| Field | Type | Notes |
|-------|------|-------|
| Tenant | Select dropdown | Required; list of all tenants |
| Tier | Select | Free / Team / Professional / Enterprise |
| Object Limit | Number | Default per tier; editable |
| User Limit | Number | Default per tier; editable |
| Valid From | Date | Default: today |
| Valid Until | Date | Required |
| Add-Ons | Multi-checkbox | Per-service add-ons |
| Hardware Binding | Toggle | Enable/disable; enabled = machine-locked |
| Delivery | Radio | SaaS (MQTT) / On-Prem (download .lic) |

On submit:
1. Validate all fields
2. Build license payload JSON
3. Sign with RSA private key (from GCP KMS in prod, `./keys/private.pem` in dev)
4. Store in DB: `licenses` table
5. If SaaS + MQTT: publish to `license/licenseData` topic
6. Audit log entry: `admin_id + tenant_id + action = "generate"`
7. Return license ID + JWT

### FR-3: Per-Tenant License View (`/superadmin/licenses/:id`)

Header: Tenant name · Tier badge · Status badge

License payload display (read-only JSON tree):
```json
{
  "jti": "uuid",
  "tenantId": "uuid",
  "tier": "professional",
  "objectLimit": 5000,
  "objectCount": 1823,
  "userLimit": 100,
  "userCount": 47,
  "addOns": ["archimate-pack", "bpmn-pack"],
  "validFrom": "2025-01-01T00:00:00Z",
  "validUntil": "2026-01-01T00:00:00Z",
  "issuedAt": "2025-01-01T00:00:00Z",
  "hardwareBinding": { "enabled": true, "machineId": "xxx" },
  "isOnPrem": false
}
```

Usage bars: Objects (used/limit with %) · Users (used/limit with %)
Actions: Revoke · Extend · Download

### FR-4: Revoke License

1. Admin clicks "Revoke" → confirmation modal
2. Required reason textarea
3. On confirm: `POST /api/v1/superadmin/licenses/:id/revoke` with `{ reason }`
4. Backend: set `revoked_at = now`, `revoked_reason = reason`
5. Add `jti` to revocation list (checked on every validation)
6. MQTT publish: `license/revoked` with `jti`
7. Audit log entry
8. Status badge → Revoked (slate)

### FR-5: Extend License

1. Admin clicks "Extend" → modal with month picker (1, 3, 6, 12)
2. Shows: current `validUntil` → new `validUntil`
3. On confirm: `POST /api/v1/superadmin/licenses/:id/extend` with `{ months }`
4. Backend: add months to `validUntil`, re-sign if needed
5. Audit log entry
6. Status badge re-evaluated (may go from `expiring` back to `active`)

### FR-6: Download `.lic` File (On-Prem Delivery)

1. Admin selects "On-Prem" delivery on license generator, or clicks Download on existing license
2. Backend generates signed license JWT
3. Returns as downloadable file: `<tenant-slug>-<date>.lic`
4. File contents: raw JWT string (one line)

### FR-7: Stripe Webhook Handler (`POST /webhooks/stripe`)

This endpoint is **public** (Stripe sends from known IPs; signature verification is the auth mechanism):

| Stripe Event | Action |
|-------------|--------|
| `invoice.paid` | Generate/extend license for `customer_id` tenant; tier from subscription |
| `customer.subscription.deleted` | Mark license as expired at `validUntil` |
| `invoice.payment_failed` | Log warning; no license change (tenant keeps last valid license) |

Webhook processing steps:
1. Verify `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET`
2. Switch on `event.type`
3. Persist license change to DB
4. If SaaS: publish to MQTT `license/licenseData`
5. Return `200` immediately (don't wait for DB commit)

---

## 7. API Design

### GET /api/v1/superadmin/licenses

#### Query Params
| Param | Notes |
|-------|-------|
| `status` | `active\|expiring\|expired\|revoked` |
| `tier` | `free\|team\|professional\|enterprise` |
| `instanceId` | Filter by instance |
| `from` / `to` | Expiry date range |
| `search` | Tenant name search |
| `page` / `limit` | Pagination |

#### Response 200 OK
```json
{
  "licenses": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "companyName": "Acme Corp",
      "contactEmail": "admin@acme.com",
      "tier": "professional",
      "objectLimit": 5000,
      "objectCount": 1823,
      "userLimit": 100,
      "userCount": 47,
      "addOns": ["archimate-pack"],
      "validFrom": "2025-01-01T00:00:00Z",
      "validUntil": "2026-01-01T00:00:00Z",
      "status": "active",
      "hardwareBinding": { "enabled": false },
      "isOnPrem": false
    }
  ],
  "total": 142
}
```

### POST /api/v1/superadmin/licenses

#### Request
```json
{
  "tenantId": "uuid",
  "tier": "professional",
  "objectLimit": 5000,
  "userLimit": 100,
  "validFrom": "2025-01-01T00:00:00Z",
  "validUntil": "2026-01-01T00:00:00Z",
  "addOns": ["archimate-pack"],
  "hardwareBinding": { "enabled": false },
  "isOnPrem": false
}
```

#### Response 201 Created
```json
{
  "id": "uuid",
  "jwt": "eyJhbG...",
  "validUntil": "2026-01-01T00:00:00Z",
  "status": "active"
}
```

### POST /api/v1/superadmin/licenses/:id/revoke

#### Request
```json
{ "reason": "Customer requested cancellation" }
```

#### Response 200 OK

### POST /api/v1/superadmin/licenses/:id/extend

#### Request
```json
{ "months": 12 }
```

#### Response 200 OK

### GET /api/v1/superadmin/licenses/:id/download

**Response**: `Content-Type: application/octet-stream` with `.lic` file attachment

### POST /api/v1/superadmin/webhooks/stripe

**Auth**: Public (Stripe signature verification only)

#### Stripe Signature Verification
```typescript
const event = stripe.webhooks.constructEvent(
  rawBody,
  signature,
  process.env.STRIPE_WEBHOOK_SECRET
);
```

---

## 8. Data Model Changes

### New Entity: `licenses`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| jti | uuid | Unique; JWT ID — used for revocation list |
| tenant_id | uuid | FK to `tenants.id`; unique index (one active per tenant) |
| tier | varchar | free/team/professional/enterprise |
| object_limit | int | |
| user_limit | int | |
| add_ons | text[] | Array of add-on feature keys |
| valid_from | timestamptz | |
| valid_until | timestamptz | |
| hardware_binding | jsonb | `{ enabled, machineId }` |
| is_on_prem | boolean | |
| revoked_at | timestamptz | Null when active |
| revoked_reason | varchar | |
| created_by | uuid | Admin user who generated |
| created_at | timestamptz | |

### New Entity: `revoked_licenses`
| Column | Type | Notes |
|--------|------|-------|
| jti | uuid | PK; JWT ID of revoked license |
| revoked_at | timestamptz | |
| revoked_by | uuid | Admin user |
| reason | varchar | |

### Existing Entity Changes: `tenants`
| Change | Description |
|--------|-------------|
| + `license_blob` (text) | Stores active license JWT; written by superadmin app |
| + `license_updated_at` (timestamptz) | |

---

## 9. Architecture / Implementation Notes

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Signing algorithm | RS256 (RSA SHA-256) | Industry standard; GCP KMS supports it |
| Private key storage | GCP Cloud KMS (prod); `./keys/private.pem` (dev) | Private key never in DB or env vars |
| Public key distribution | Env var `LICENSE_PUBLIC_KEY` in main app | Main app reads public key to verify |
| Key rotation | Via `kid` (Key ID) header in JWT | Multiple keys can coexist; validator picks by `kid` |
| SaaS delivery | MQTT `license/licenseData` topic | License delivery is push-based, not HTTP polling |
| On-prem delivery | `.lic` file download | Customer self-installs license file |

### RSA Key Pair
```
Development:  ./keys/private.pem  (gitignored) + ./keys/public.pem  (gitignored)
Staging:      GCP Secret Manager (PEM string) + env var
Production:   GCP Cloud KMS (HSM-backed) → KMS never exposes private key outside HSM
```

### License JWT Structure
```json
{
  "header": { "alg": "RS256", "kid": "key-v1", "typ": "JWT" },
  "payload": {
    "jti": "uuid",
    "tenantId": "uuid",
    "tier": "professional",
    "objectLimit": 5000,
    "userLimit": 100,
    "addOns": ["archimate-pack"],
    "validFrom": 1704067200,
    "validUntil": 1735689600,
    "iat": 1704067200,
    "iss": "designfoundry-superadmin"
  },
  "signature": "base64..."
}
```

---

## 10. UI/UX Requirements

### License List Layout
```
┌──────────────────────────────────────────────────────────────────────┐
│ Licenses                              [+ Generate License] [Export CSV]│
├──────────────────────────────────────────────────────────────────────┤
│ [Status ▼]  [Tier ▼]  [Instance ▼]  [From]  [To]  [🔍 Search...]     │
├──────────────────────────────────────────────────────────────────────┤
│ Tenant     │ Tier │ Status  │ Expires    │ Objects    │ Users  │ ··· │
│ Acme Corp  │ Pro  │ 🟢 Active│ Jan 1 2026 │ 1823/5000  │ 47/100│ ··· │
│ Beta Corp  │ Team │ 🟡 Expires│ May 15 25  │ 234/500    │ 12/25 │ ··· │
└──────────────────────────────────────────────────────────────────────┘
```

### License Generator Form Layout
```
┌─────────────────────────────────────────────────────────────┐
│ Generate License                                       [×] │
├─────────────────────────────────────────────────────────────┤
│ Tenant *        [Select tenant            ▼]               │
│ Tier *          [Professional            ▼]               │
│ Object Limit    [5000          ]                          │
│ User Limit      [100           ]                          │
│ Valid From      [2025-01-01   ]                          │
│ Valid Until *   [2026-01-01   ]                          │
│ Add-Ons         ☑ ArchiMate Pack  ☑ BPMN Pack           │
│ Hardware Bind   [Toggle: OFF]                             │
│ Delivery        ○ SaaS (MQTT)  ● On-Prem (.lic file)      │
│                                                             │
│                                  [Cancel]  [Generate]     │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| RSA private key | GCP Cloud KMS (HSM) in prod; never in source code or env files |
| License forgery | Requires RSA private key; compromise of admin app requires KMS breach |
| Revocation | `jti` checked against revocation list on every validation |
| Webhook auth | Stripe signature verification is the only mechanism |
| Admin actions | All license operations logged to `admin_audit_log` |
| On-prem key | On-prem customers get their own key pair; never share SaaS private key |

---

## 12. Out of Scope

- Automatic license renewal cron (Stripe webhook handles subscription renewal)
- License field editing post-generation (revoke + re-issue)
- Multi-tenant bulk license generation (one at a time for auditability)
- BYOAI license integration (separate S083 scope)

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Multiple active licenses | Allow or error? | Error: one active license per tenant |
| License payload encryption | Encrypt payload beyond JWT signature? | No: signature provides integrity; no PII in payload |
| MQTT broker | Which broker? | GCP IoT Core or custom Mosquitto (existing infra) |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| GCP Cloud KMS | External | RSA signing in production |
| GCP Secret Manager | External | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Stripe | External | Webhook events drive license creation |
| MQTT broker | External | SaaS license delivery via MQTT |
| R1-02 (Tenant Management) | Spec | Tenant dropdown needs tenant list |
| S073 (Unified License Architecture) | External spec | Defines license format and validation |

---

## 15. Linked Specs

- **S073** (Unified License Architecture) — Platform spec defining license format and enforcement
- **R1-03** (Billing & Subscriptions) — Stripe webhook handler creates licenses on payment
- **R1-06** (Observability) — Audit log for all license operations

---

## 16. Verification & Testing

### Test Cases
| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Generate license → JWT is valid | JWT passes RS256 verification with public key | Unit |
| TC2 | Generate with all fields → stored correctly | DB record matches all form fields | Integration |
| TC3 | Revoke license → jti in revocation list | `GET /licenses/revoked` includes jti | Unit |
| TC4 | Revoked license validated → rejected | License validation returns `revoked` | Unit |
| TC5 | Extend 12 months → validUntil + 12 months | New validUntil = old + 12 months | E2E |
| TC6 | Download .lic → file is valid JWT | File contents = raw JWT string | Unit |
| TC7 | Stripe `invoice.paid` → license created | New license in DB for correct tenant | Integration (mock Stripe) |
| TC8 | Hardware binding enabled → machineId in payload | Payload includes machineId | Unit |
| TC9 | One active license per tenant enforced | Generating second active → 409 Conflict | Unit |
