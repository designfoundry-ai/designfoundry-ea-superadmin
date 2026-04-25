# R1-15 — Instance Authentication

**Spec ID:** R1-15
**Title:** Instance Authentication — Superadmin ↔ EA Instance API Key Trust
**Release:** R1
**Priority:** P0
**Status:** ⬜ Not Started
**Created:** 2026-04-26
**Updated:** 2026-04-26
**Spec Owner:** TBD
**Backlog Ref:** P10-superadmin

---

## 1. Feature Overview

R1-07 (Instance Registry) describes *what* the superadmin tracks. R1-15 describes *how* the
superadmin actually talks to a registered instance. Each EA (Enterprise Architect) instance is an
independently deployed stack — its own PostgreSQL database, its own NestJS backend, its own
Next.js frontend. The superadmin console is a separate deployment with its **own dedicated
PostgreSQL database** (it does not share schemas with EA instances).

Trust between the superadmin and an EA instance is established by a per-instance, randomly
generated **API key**. The superadmin generates the key during instance registration, stores it
encrypted-at-rest in its own DB, and presents it to the operator exactly once. The operator
configures the same key on the EA instance via the `PLATFORM_ADMIN_API_KEY` environment
variable. From that point on, the superadmin reaches the instance via its public REST API,
sending the key in the `X-Platform-Key` header. A new `PlatformAdminGuard` on the EA instance
validates the header and grants cross-tenant access to a small `/api/v1/platform/*` routes
surface that exposes only what the superadmin needs (tenants, users, stats, activity, system
health).

This pattern keeps the superadmin loosely coupled to instances (no shared DB, no VPN, no JWT
trust federation) and makes on-prem deployments trivial — the customer pastes a key into an
env var and the superadmin can talk to them.

---

## 2. Goals

- [ ] **Per-instance API key** — each registered EA instance has its own 256-bit key
- [ ] **Encrypted at rest** — keys stored AES-256-GCM encrypted in the superadmin DB
- [ ] **Show-once disclosure** — the plaintext key is returned once at creation/rotation, never again
- [ ] **PlatformAdminGuard on EA instance** — validates `X-Platform-Key` header against `PLATFORM_ADMIN_API_KEY` env
- [ ] **`/api/v1/platform/*` endpoints** — narrow, read-mostly cross-tenant API for the superadmin
- [ ] **Connection test** — superadmin can verify a registered instance is reachable and the key works
- [ ] **Key rotation without downtime** — generate new key, deploy on instance, verify, deactivate old
- [ ] **Disabled-by-default on instance** — unset `PLATFORM_ADMIN_API_KEY` → endpoints return 404
- [ ] **Dev-mode auto key** — local dev gets a generated key printed once in the EA instance log

---

## 3. Non-Goals

- mTLS or client certificates (deferred — API key + HTTPS is sufficient for R1)
- OAuth / OIDC federation between superadmin and instances (out of scope)
- Per-tenant credentials (this is a *platform-level* trust, not a tenant-level one)
- Replacing the superadmin's own user authentication (covered separately by R0/R1-06)
- Bidirectional auth (instances do not call back into the superadmin in R1)
- Direct database access from superadmin to EA instance DBs (explicitly forbidden — all
  cross-instance reads must go through the platform API)

---

## 4. User Story

> As a **Platform Operator** registering a new on-prem EA instance,
> I want to generate an API key in the superadmin console and paste it into the customer's
> instance configuration,
> so that I can manage their tenants, view their stats, and monitor their health from one
> console — without ever needing direct DB credentials or a VPN to their environment.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Superadmin DB is separate from any EA instance DB | Inspection | `ADMIN_DATABASE_URL` points to `designfoundry_admin`; instances table lives there |
| AC2 | Creating an instance returns the plaintext API key exactly once | E2E | POST /instances → response includes `apiKey`; subsequent GET /instances/:id never includes it |
| AC3 | Stored API key is AES-256-GCM encrypted | Unit | Inspect `api_key_encrypted` column → not equal to plaintext; decrypt with key → matches |
| AC4 | A SHA-256 hash of the key is stored alongside for fast lookup | Unit | `api_key_hash` column populated; equals `sha256(plaintext)` |
| AC5 | EA instance returns 401 when `X-Platform-Key` is missing | Integration | curl /api/v1/platform/health without header → 401 |
| AC6 | EA instance returns 401 when key is wrong | Integration | curl with wrong key → 401, not 200 with empty body |
| AC7 | EA instance returns 404 for `/api/v1/platform/*` when `PLATFORM_ADMIN_API_KEY` is unset | Integration | Unset env → routes do not exist |
| AC8 | Connection test calls EA `/api/v1/platform/health` and updates `last_health_check` | E2E | Click "Test Connection" → instance row shows healthy + recent timestamp |
| AC9 | Key rotation produces a new plaintext key once; old key keeps working until deactivated | Integration | Rotate → new key returned; old key still works; mark old deactivated → old returns 401 |
| AC10 | API keys never appear in logs (request, response, error) | Inspection | Grep app logs after a sequence of platform requests — no key material |

---

## 6. Functional Requirements

### FR-1: API Key Generation

- 256 bits of entropy (32 bytes) from a cryptographic RNG (Node `crypto.randomBytes`).
- Encoded as URL-safe base64 (no `+`, no `/`, no padding) for ergonomic copy/paste.
- Prefixed with `dfp_` (DesignFoundry Platform) so accidental leaks are recognisable in logs:
  `dfp_<43-char-base64url>`.
- Generated at:
  - Instance creation
  - Explicit rotation
  Never reused across instances.

### FR-2: Encrypted Storage

- Algorithm: **AES-256-GCM** (authenticated encryption, prevents tampering).
- Master key: `INSTANCE_CREDENTIALS_KEY` env var (32 bytes, base64-encoded).
- Per-row 12-byte random IV; 16-byte auth tag stored alongside ciphertext.
- Storage format in `api_key_encrypted` column (TEXT):
  `<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>`.
- A SHA-256 hash of the plaintext key is also stored in `api_key_hash` so future enhancements
  (e.g. an inbound webhook receipt from the EA instance) can identify the calling instance
  without needing decryption.

### FR-3: Show-Once Disclosure

- `POST /api/superadmin/instances` and `POST /api/superadmin/instances/:id/rotate-key` return
  the plaintext key in the response body **exactly once**.
- All other endpoints (`GET /instances`, `GET /instances/:id`, list pages) MUST NOT return the
  plaintext or any decryptable form. The encrypted blob and hash stay server-side.
- The UI surfaces the key in a one-time modal with a "Copy" button and a clear warning that the
  key cannot be retrieved later — only rotated.

### FR-4: PlatformAdminGuard (EA Instance Side)

A new NestJS guard on the EA instance with this exact behaviour:

```
1. Read `X-Platform-Key` request header.
2. If header missing → 401 Unauthorized.
3. Read `PLATFORM_ADMIN_API_KEY` env var at module init.
4. If env var unset → the guard MUST NOT register the route group at all (404).
5. Compare header to env var using `crypto.timingSafeEqual` → constant-time comparison.
6. On match → attach `req.platformAdmin = true` and proceed.
7. On mismatch → 401 with body `{ "error": "invalid platform key" }`. No further detail.
```

The guard short-circuits the per-tenant scoping that normal EA requests undergo. Routes
protected by `PlatformAdminGuard` operate **cross-tenant** by design.

### FR-5: Platform API Routes (EA Instance Side)

All routes are prefixed `/api/v1/platform/*` and protected by `PlatformAdminGuard`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/platform/health` | `{ status, version, uptime, db: 'up' \| 'down' }` |
| GET | `/platform/tenants` | List all tenants with summary stats (count, MRR if known, status) |
| GET | `/platform/tenants/:id` | Tenant detail + user list |
| GET | `/platform/stats` | Aggregate instance stats (totals across tenants) |
| GET | `/platform/users` | Cross-tenant user list (paginated, filterable by tenant) |
| GET | `/platform/activity` | Recent activity events (paginated, filterable) |
| GET | `/platform/system` | System health metrics (DB conns, error rate, deployment info) |

Response envelope matches existing EA conventions (e.g. `{ data, total, page, limit }`).

### FR-6: Instance Registration Flow

1. Operator opens `/superadmin/instances` and clicks **Add Instance**.
2. Form: `name`, `url` (e.g. `https://acme.designfoundry.ai`), `environment`
   (`production` | `staging` | `dev`).
3. Superadmin generates an API key (FR-1), encrypts (FR-2), stores with `status='pending'`.
4. UI shows the plaintext key in a one-time modal with copy button + warning.
5. Operator pastes the key into the EA instance configuration (env var
   `PLATFORM_ADMIN_API_KEY`) and restarts the EA service.
6. Operator clicks **Test Connection** in the superadmin UI. The superadmin calls
   `GET <url>/api/v1/platform/health` with `X-Platform-Key: <decrypted key>` and a 5s timeout.
7. On 200 → `status='active'`, `last_health_check=now()`, instance moves to "healthy" badge.
8. On any other response or timeout → `status` stays `pending`, error surfaced to operator.

### FR-7: Key Rotation (Zero Downtime)

The rotation procedure is interactive and deliberately slow because it involves a human
reconfiguring the EA instance:

1. Operator clicks **Rotate Key** on instance detail.
2. Confirmation dialog: "This generates a new key. Configure it on the instance before the old
   key is deactivated."
3. Superadmin generates a new key, stores it as `pending_api_key_encrypted` (additional column),
   returns plaintext once.
4. Operator updates `PLATFORM_ADMIN_API_KEY` on the instance and restarts.
5. Operator clicks **Verify New Key** → superadmin calls `/platform/health` with the new key.
6. On success → swap: `api_key_encrypted = pending_api_key_encrypted`, clear pending column,
   record `key_rotated_at`. The old key is now invalid.
7. If verification never happens within 7 days → `pending_api_key_encrypted` is purged on a
   nightly job; old key remains valid.

### FR-8: Instance Deactivation

`DELETE /api/superadmin/instances/:id` performs a **soft** deactivate:
- `status='deactivated'`, `deactivated_at=now()`.
- Encrypted key is **wiped** (NULLed) from the row to minimise blast radius.
- Instance is hidden from the active list. Re-activation requires re-registering with a fresh
  key.

### FR-9: Dev Mode

- On the EA instance: if `NODE_ENV !== 'production'` and `PLATFORM_ADMIN_API_KEY` is unset, on
  first boot generate an ephemeral key, log it once with a clear marker, and use it for the
  current process lifetime. The key is *not* persisted; restart → new key.
- On the superadmin: if `INSTANCE_CREDENTIALS_KEY` is unset and `NODE_ENV !== 'production'`,
  derive a dev-only key from a static value (with a loud warning at startup that this is not
  safe for production).

---

## 7. API Design

### Superadmin Side

#### POST /api/superadmin/instances

**Auth:** Required (superadmin JWT).

##### Request
```json
{
  "name": "Acme EU Production",
  "url": "https://acme.designfoundry.ai",
  "environment": "production"
}
```

##### Response 201 Created — *plaintext key returned exactly once*
```json
{
  "id": "uuid",
  "name": "Acme EU Production",
  "url": "https://acme.designfoundry.ai",
  "environment": "production",
  "status": "pending",
  "createdAt": "2026-04-26T10:00:00Z",
  "apiKey": "dfp_aB3c...43chars",
  "apiKeyWarning": "This key will not be shown again. Store it securely."
}
```

##### Errors
| Code | Condition | Body |
|------|-----------|------|
| 400  | URL invalid / name missing | `{ "error": "...", "field": "..." }` |
| 401  | Not authenticated | `{ "error": "Unauthorized" }` |
| 409  | URL already registered | `{ "error": "instance with this URL already exists" }` |

#### GET /api/superadmin/instances

##### Response 200 OK — *no plaintext or encrypted key*
```json
{
  "instances": [
    {
      "id": "uuid",
      "name": "Acme EU Production",
      "url": "https://acme.designfoundry.ai",
      "environment": "production",
      "status": "active",
      "lastHealthCheck": "2026-04-26T09:55:00Z",
      "createdAt": "2026-04-01T00:00:00Z"
    }
  ],
  "total": 1
}
```

#### GET /api/superadmin/instances/:id
Same fields as list, single object.

#### POST /api/superadmin/instances/:id/test
Triggers a health check using the stored key. Response 200 with updated health info, or 502
if the instance is unreachable / returns non-2xx.

```json
{
  "ok": true,
  "status": "active",
  "lastHealthCheck": "2026-04-26T10:00:00Z",
  "instanceVersion": "1.4.2",
  "latencyMs": 142
}
```

#### POST /api/superadmin/instances/:id/rotate-key
Returns a new plaintext key once. Old key remains valid until verified-and-swapped.

```json
{
  "id": "uuid",
  "apiKey": "dfp_xY9...43chars",
  "apiKeyWarning": "This key will not be shown again."
}
```

#### DELETE /api/superadmin/instances/:id
Soft deactivate. Wipes the encrypted key. Returns 204.

### EA Instance Side

#### GET /api/v1/platform/health
**Auth:** `X-Platform-Key` header (PlatformAdminGuard).

```json
{
  "status": "ok",
  "version": "1.4.2",
  "uptimeSeconds": 31415,
  "db": "up"
}
```

#### GET /api/v1/platform/tenants
```json
{
  "tenants": [
    { "id": "uuid", "name": "...", "slug": "...", "status": "active",
      "userCount": 23, "objectCount": 1872, "createdAt": "..." }
  ],
  "total": 12
}
```

(Other platform endpoints follow the same pattern — see FR-5.)

---

## 8. Data Model Changes

### New DB: `designfoundry_admin`

The superadmin runs against its own PostgreSQL database. R1-15 introduces the bootstrap schema.

### New Entity: `instances` (in superadmin DB)

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| id | uuid | N | gen_random_uuid() | PK |
| name | varchar(255) | N | | Human-readable |
| url | varchar(512) | N | | Base URL of EA instance (no trailing slash) |
| environment | varchar(32) | N | | `production` / `staging` / `dev` |
| api_key_encrypted | text | Y | | `iv:tag:ciphertext` AES-256-GCM blob (NULL after deactivate) |
| api_key_hash | char(64) | Y | | SHA-256 hex of the plaintext key (NULL after deactivate) |
| pending_api_key_encrypted | text | Y | | Set during rotation; cleared on verify or after 7d |
| pending_api_key_hash | char(64) | Y | | Companion to pending_api_key_encrypted |
| status | varchar(16) | N | 'pending' | `pending` / `active` / `inactive` / `deactivated` |
| last_health_check | timestamptz | Y | | Last successful platform/health probe |
| last_health_status | varchar(16) | Y | | `healthy` / `unhealthy` / `unknown` |
| instance_version | varchar(32) | Y | | Reported by /platform/health |
| key_rotated_at | timestamptz | Y | | Last successful rotation swap |
| deactivated_at | timestamptz | Y | | Set by soft deactivate |
| created_at | timestamptz | N | now() | |
| updated_at | timestamptz | N | now() | |

Indexes:
- `UNIQUE (url) WHERE status != 'deactivated'` — prevent dupes for active instances
- `INDEX (status)` — quick filtering

### New Entity: `platform_events` (in superadmin DB)

For future event ingestion from instances. R1-15 only creates the table; usage comes later.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| instance_id | uuid | FK → instances.id |
| event_type | varchar(64) | e.g. `tenant.created`, `health.degraded` |
| payload | jsonb | Free-form event body |
| received_at | timestamptz | now() |

### New Entity: `admin_audit_log` (in superadmin DB)

Moved from any shared DB into the superadmin's own DB.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| admin_user_id | uuid | |
| admin_email | varchar(255) | |
| action | varchar(64) | e.g. `instance.created`, `instance.key_rotated` |
| target_type | varchar(64) | e.g. `instance` |
| target_id | uuid | |
| details | jsonb | |
| ip_address | varchar(64) | |
| created_at | timestamptz | now() |

### New Entity: `super_admins` (in superadmin DB)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| email | varchar(255) | UNIQUE |
| name | varchar(255) | |
| password_hash | varchar(255) | bcrypt; nullable when SSO-only |
| status | varchar(16) | `active` / `disabled` |
| created_at | timestamptz | now() |
| last_login_at | timestamptz | |

### Migration Notes

- New database `designfoundry_admin` provisioned on the same PostgreSQL server in dev; in
  production it is a separate Cloud SQL instance.
- An idempotent init script (`initAdminDb()`) runs on first request and creates the four
  tables if they do not exist. No long-running migrations in R1.
- The `licenses` and `tenants` tables that the existing dev scaffold currently references in
  `db.ts` continue to live in the legacy shared DB until a follow-up spec migrates them. R1-15
  introduces a *second* pool (`adminPool`) targeting `ADMIN_DATABASE_URL`.

---

## 9. Architecture / Implementation Notes

### Technical Approach

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Transport | HTTPS REST | Simplest possible. EA instances already serve REST. |
| Auth header | `X-Platform-Key` | Custom header — distinguishes from end-user auth (`Authorization: Bearer`) |
| Key format | `dfp_<base64url>` | Recognisable in logs/leaks (à la GitHub's `ghp_*`) |
| Encryption | AES-256-GCM | Authenticated; modern; built into Node `crypto` |
| Master key location | env var `INSTANCE_CREDENTIALS_KEY` (Secret Manager in prod) | Standard pattern; rotatable |
| Key comparison on EA side | `crypto.timingSafeEqual` | Avoids timing attacks |
| HTTP client | `fetch` with 5s `AbortController` timeout | No extra dependency |
| Persistence | dedicated PG database via `pg` Pool | Already in deps; mirrors existing `db.ts` |

### Key Decisions to Resolve

| Decision | Options | Recommendation |
|----------|---------|-----------------|
| Should EA instances also call back to superadmin? | Yes (event push) / No (poll only) | **No for R1.** Adds reverse trust complexity. R2 can add an inbound webhook with HMAC. |
| Per-instance IP allowlist on EA side? | Yes / No / Optional config | **Optional config**, default off. Set `PLATFORM_ADMIN_ALLOWED_IPS` to a CSV. |
| Rate limiting on platform API? | Yes / No | **Yes**, but lenient: 600 req/min per key. Superadmin polls infrequently. |
| Key prefix `dfp_` vs `ea_` vs no prefix | n/a | **`dfp_`** — recognisable, scannable, GitHub secret-scanning style |
| Where to host `INSTANCE_CREDENTIALS_KEY` | env / GCP Secret Manager / KMS | GCP Secret Manager in prod, env in dev. |

### Sequence: First-Time Registration

```
operator        superadmin                                EA instance
  │   add        │                                            │
  ├─────────────▶│  generate key (32 random bytes)            │
  │              │  encrypt + store (status=pending)          │
  │ show key one │                                            │
  │◀─────────────┤                                            │
  │  copy/paste                                               │
  │  PLATFORM_ADMIN_API_KEY=dfp_…  + restart                  │
  ├──────────────────────────────────────────────────────────▶│
  │  click test  │                                            │
  ├─────────────▶│  GET /api/v1/platform/health               │
  │              ├───────── X-Platform-Key: dfp_… ───────────▶│
  │              │                                            │ guard validates
  │              │◀──────── 200 { status, version } ──────────┤
  │              │  status=active, last_health_check=now()    │
  │  ✓ healthy   │                                            │
  │◀─────────────┤                                            │
```

---

## 10. UI/UX Requirements

### Key Screens

| Screen | Purpose | Key Interactions |
|--------|---------|-----------------|
| `/superadmin/instances` | List + add instances | Click "Add Instance" → modal → submit → key modal → test connection |
| `/superadmin/instances/:id` | Detail + rotate / deactivate | Click "Rotate Key" → confirm → key modal → verify |

### One-Time Key Modal

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠  API Key Generated                                         │
│                                                             │
│ This key will be shown ONCE. Copy it and configure it on    │
│ the instance as PLATFORM_ADMIN_API_KEY.                     │
│                                                             │
│ ┌─────────────────────────────────────────────┐  [Copy]    │
│ │ dfp_aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5 │            │
│ └─────────────────────────────────────────────┘             │
│                                                             │
│ I have copied the key safely.            [I have copied it] │
└─────────────────────────────────────────────────────────────┘
```

The "I have copied it" button is the only way to dismiss the modal. Closing the page mid-modal
does not lose the key (modal state survives), but once dismissed, only rotation can produce a
new key.

### Status Indicators

| Badge | Meaning |
|-------|---------|
| 🟡 Pending | Created, not yet verified |
| 🟢 Active | Last test connection succeeded |
| 🔴 Unhealthy | Last test connection failed |
| ⚪ Deactivated | Soft-removed; key wiped |

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| Key at rest | AES-256-GCM with master key from Secret Manager |
| Key in transit | HTTPS only; the EA instance must reject `http://` in production |
| Key in logs | Header is in an explicit denylist for the request logger; error responses never echo the key |
| Key in URLs | Never — header only. Query-string keys are forbidden. |
| Brute force | Rate limit 600 rpm per IP on `/api/v1/platform/*`; 401 for any failure |
| Replay | Not addressed in R1 (HTTPS provides forward secrecy; deferred mTLS would harden this) |
| Show-once disclosure | UI enforces; API never re-reads the plaintext after creation |
| Deactivation | Encrypted blob NULLed; deactivated row retained for audit |
| Key rotation | Two-phase (pending → active) so the operator can update the instance without downtime |
| Audit | Every create / rotate / deactivate writes to `admin_audit_log` |
| Compliance | No personal data in keys themselves; rotation cadence is operator-driven (no automatic policy in R1) |

---

## 12. Out of Scope

- mTLS / client certs
- OIDC / JWT trust federation between superadmin and instance
- Automatic key rotation policies (90-day expiry, etc.)
- HMAC-signed instance → superadmin webhooks (R2)
- Geographic / IP allowlisting beyond simple CSV env var
- Multiple keys per instance (only one active + one pending)
- Direct DB-to-DB replication

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Should the `dfp_` prefix be configurable? | Yes / No | No — recognisability matters more than flexibility |
| Should we expose `/platform/health` without auth? | Auth / No auth | **Auth**. Even health pings should prove identity to avoid info leakage about the deployment. |
| Where does the `INSTANCE_CREDENTIALS_KEY` live in dev? | env / .env.local / autogenerated | `.env.local` with a documented dev-only fallback for first run |
| Polling cadence for background health check | 1 min / 5 min / on-demand | **On-demand** for R1 (Test button); a scheduler job is R1-07 territory |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| R1-07 (Instance Registry) | Spec | Defines the `/superadmin/instances` UX surface this spec authenticates |
| R1-08 (Cross-Instance Tenant Portal) | Spec | First consumer of `/api/v1/platform/tenants` |
| R1-09 (Cross-Instance Observability) | Spec | First consumer of `/api/v1/platform/system` and `/platform/activity` |
| `pg` library | External | Already in `package.json` |
| Node `crypto` | Built-in | AES-256-GCM, randomBytes, timingSafeEqual |
| GCP Secret Manager | External (prod) | `INSTANCE_CREDENTIALS_KEY` storage |

---

## 15. Linked Specs

- **R1-07** (Instance Registry) — R1-15 is the auth layer beneath the registry UX
- **R1-08** (Cross-Instance Tenant Portal) — Consumes the platform API
- **R1-09** (Cross-Instance Observability) — Consumes the platform API
- **R1-13** (Instance Provisioning & Onboarding) — Onboarding flow ends with a R1-15 key handshake

---

## 16. Verification & Testing

### Test Cases

| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Create instance → response includes `apiKey` | 201 + `apiKey` matches `dfp_<43>` regex | Integration |
| TC2 | List instances after create → no `apiKey` field anywhere | Field absent in every row | Integration |
| TC3 | Encrypted column ≠ plaintext | Decrypt with master key → equals plaintext | Unit |
| TC4 | `api_key_hash` equals SHA-256 of plaintext | hex match | Unit |
| TC5 | EA call with correct key → 200 | `/platform/health` returns ok | Integration (against EA stub) |
| TC6 | EA call with wrong key → 401 | Body `{ "error": "invalid platform key" }` | Integration |
| TC7 | EA call with missing header → 401 | Same as TC6 | Integration |
| TC8 | EA env unset → routes 404 | Module guard prevents registration | Integration |
| TC9 | Rotate key → new key returned; old still valid | Both keys work for the verification window | Integration |
| TC10 | Verify-rotation → swap; old key now 401 | Old key invalid post-swap | Integration |
| TC11 | Deactivate → encrypted column NULL | DB inspection | Unit |
| TC12 | Test connection with unreachable URL → 502 + status unchanged | Timeout after 5s | Integration |
| TC13 | Audit log records create / rotate / deactivate | Three rows in `admin_audit_log` | Integration |
| TC14 | Logger does not echo the key | grep stdout for `dfp_` after a sequence of calls → no match | Manual / inspection |

### Test Data Requirements

- A running EA instance stub (or in-process Express mock) that exposes `/api/v1/platform/health`
  protected by the same `X-Platform-Key` contract.
- `INSTANCE_CREDENTIALS_KEY` set to a known 32-byte base64 value in CI.
- A throwaway `designfoundry_admin_test` PostgreSQL database created and dropped per test run.
