# R1-16 — Instance Self-Registration

**Spec ID:** R1-16
**Title:** Instance Self-Registration — Instance-Initiated Onboarding with Retry
**Release:** R1
**Priority:** P1
**Status:** ⬜ Not Started
**Created:** 2026-05-17
**Updated:** 2026-05-17
**Spec Owner:** TBD
**Backlog Ref:** P10-superadmin

---

## 1. Feature Overview

Today, registering an EA instance is a manual, multi-step dance (R1-07 + R1-15):

1. Operator opens the superadmin UI and creates a row.
2. Superadmin generates an API key and shows it **once**.
3. Operator pastes the key into the instance's `PLATFORM_ADMIN_API_KEY` env var.
4. Operator restarts the instance.
5. Operator triggers a health check to flip `pending → active`.

This is painful for local dev (rebooting every time), fragile in production
(secret leaking through copy-paste, lost keys), and impossible for ephemeral /
auto-scaled deployments.

**R1-16 replaces steps 2–5 with an instance-initiated handshake.** On startup,
an EA instance reads a single env var (`SUPERADMIN_URL`) and a shared bootstrap
token (`PLATFORM_REGISTRATION_TOKEN`), then calls the superadmin's
`POST /api/instances/register` endpoint. The superadmin issues a per-instance
API key, returns it in the response, and the instance persists it in its own
local DB. If the superadmin is unreachable, the instance retries with
exponential backoff — boot is never blocked.

Once registered, the instance heartbeats periodically. Re-registration is
automatic if the local key is rejected (e.g. instance row deleted on the
superadmin side).

---

## 2. Goals

- [ ] **One-env-var onboarding** — instance needs only `SUPERADMIN_URL` + `PLATFORM_REGISTRATION_TOKEN` to register
- [ ] **No restart required** — instance generates its own stable `instanceId`, persists the issued API key locally, no env-var rewrite
- [ ] **Boot-time non-blocking** — if superadmin is down, instance starts normally and retries in background
- [ ] **Exponential-backoff retry** — 5s → 10s → 30s → 1m → 5m cap, indefinitely
- [ ] **Heartbeat loop** — once registered, instance pings superadmin every 60s (keeps `last_health_check` fresh; replaces superadmin-pull health checks for self-registered instances)
- [ ] **Approval gating** — production instances land in `awaiting_approval` and require an operator click; `dev` environment auto-approves
- [ ] **Auto re-registration** — if heartbeat returns `401`, instance assumes its row was wiped and re-registers
- [ ] **Idempotent registration** — re-sending the same `instanceId` returns the existing record (no duplicate rows)
- [ ] **Bootstrap token rotation** — superadmin admins can rotate `PLATFORM_REGISTRATION_TOKEN` without disturbing already-registered instances

---

## 3. Non-Goals

- Mutual TLS or workload identity federation (deferred — bootstrap token over HTTPS is sufficient for R1)
- Discovery: instances must still know the superadmin URL (no mDNS / DNS-SD)
- Removing the manual flow — R1-15 stays as the fallback for air-gapped on-prem deployments
- Instance-to-instance auto-discovery
- Automatic deprovisioning when an instance goes silent (operator-driven)

---

## 4. User Story

> As a **Platform Operator** spinning up a new EA instance (local dev, staging,
> cloud-managed, or on-prem),
> I want the instance to register itself with the superadmin on boot,
> so that I don't have to copy API keys, edit env files, or restart anything —
> the instance simply appears in the registry, ready for me to approve (prod)
> or instantly active (dev).

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Instance with only `SUPERADMIN_URL` + `PLATFORM_REGISTRATION_TOKEN` registers on first boot | E2E | Start fresh rezonator → row appears in `instances` within 5s |
| AC2 | Instance does not block boot if superadmin is unreachable | Integration | Start rezonator with bad `SUPERADMIN_URL` → app reaches "ready" within normal time; registration logged as pending |
| AC3 | Instance retries with exponential backoff until success | Integration | Start rezonator → start superadmin 60s later → registration succeeds, no manual intervention |
| AC4 | `dev` environment auto-activates; `production`/`staging` lands in `awaiting_approval` | E2E | Register dev → status=`active`; register prod → status=`awaiting_approval` |
| AC5 | Re-registration with same `instanceId` returns existing record (no duplicate) | Unit | Two POSTs with same `instanceId` → one row, same `apiKey` returned only on first call |
| AC6 | Heartbeat returning 401 triggers re-registration | Integration | Delete instance row → next heartbeat → instance re-registers and resumes |
| AC7 | Invalid bootstrap token returns 401 and is rate-limited | Security | 10 bad-token POSTs from same IP → first responds 401, subsequent get 429 |
| AC8 | API key is never written to logs, env, or filesystem outside the instance's DB | Inspection | Grep instance logs, env, fs — key absent |
| AC9 | Bootstrap token rotation does not invalidate existing instance keys | Integration | Rotate token → existing instance heartbeats keep working |

---

## 6. Functional Requirements

### FR-1: Instance-Side Registration Client

**Env vars on the EA instance:**

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `SUPERADMIN_URL` | yes | — | e.g. `https://admin.designfoundry.ai` or `http://localhost:3002` |
| `PLATFORM_REGISTRATION_TOKEN` | yes | — | Shared bootstrap secret; same value set in superadmin env |
| `INSTANCE_NAME` | no | hostname | Display name shown in the registry |
| `INSTANCE_ENVIRONMENT` | no | `production` | One of `production` / `staging` / `dev` |
| `INSTANCE_PUBLIC_URL` | no | derived from listen addr | URL the superadmin can reach back at |

**Local persistence (`platform_registration` table in the instance's own DB):**

```sql
CREATE TABLE platform_registration (
  id            UUID PRIMARY KEY,         -- the stable instanceId; generated on first boot
  api_key       TEXT,                     -- received from superadmin; null until registered
  registered_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  last_status   TEXT                      -- pending / awaiting_approval / active / rejected
);
```

Exactly one row. `id` is generated locally on first boot and never changes —
it is the instance's identity for the lifetime of the local DB.

**Boot sequence:**

1. Open local DB; ensure `platform_registration` row exists (insert with fresh UUID if not).
2. If `api_key` is already set → skip registration, jump to heartbeat loop.
3. Otherwise, kick off background registration task (does **not** block app startup).
4. Background task: POST `${SUPERADMIN_URL}/api/instances/register` with retry.
5. On success: write `api_key`, `last_status`, start heartbeat loop.
6. Heartbeat loop: every 60s POST `${SUPERADMIN_URL}/api/instances/heartbeat`
   with `X-Instance-Key: <api_key>`. On 401, clear `api_key` and restart from step 3.

### FR-2: Retry Policy

Exponential backoff with jitter:

```
attempt 1: wait 5s   ± 1s
attempt 2: wait 10s  ± 2s
attempt 3: wait 30s  ± 5s
attempt 4: wait 60s  ± 10s
attempt 5+: wait 300s ± 30s (cap)
```

Retries are indefinite (no max attempts). All non-2xx responses retry except:

| Status | Behaviour |
|--------|-----------|
| `401` (bad bootstrap token) | Log fatal-level error, keep retrying at cap rate (operator may rotate token) |
| `409` (instanceId conflict) | Log fatal-level error, stop retrying — requires manual investigation |
| `403` (registration disabled) | Stop retrying; expose in admin UI as "blocked" |

### FR-3: Superadmin Registration Endpoint

`POST /api/instances/register` — **unauthenticated** (validated by bootstrap token in body).

**Request:**
```json
{
  "instanceId": "uuid",
  "name": "rezonator-prod-eu-1",
  "url": "https://acme.designfoundry.ai",
  "environment": "production",
  "version": "1.4.2",
  "registrationToken": "<bootstrap secret>"
}
```

**Response 201 (new) or 200 (existing):**
```json
{
  "instanceId": "uuid",
  "apiKey": "df_xxxxxxxx...",
  "status": "awaiting_approval",
  "heartbeatIntervalSec": 60
}
```

`apiKey` is returned **only on creation**. On subsequent calls with the same
`instanceId`, the response omits `apiKey` and just confirms current status.
(If the instance lost its key, the operator must delete-and-reapprove.)

**Errors:**
- `400` — malformed body
- `401` — bad/missing `registrationToken`
- `403` — `PLATFORM_REGISTRATION_ENABLED=false`
- `409` — `instanceId` exists with a different `url`
- `429` — rate limit

### FR-4: Superadmin Heartbeat Endpoint

`POST /api/instances/heartbeat` — authenticated by `X-Instance-Key` header.

**Request:**
```json
{ "version": "1.4.3", "uptimeSec": 12345 }
```

**Response 200:**
```json
{ "status": "active", "heartbeatIntervalSec": 60 }
```

Side effect: updates `last_health_check`, `last_health_status='healthy'`,
`instance_version` on the matched row. Replaces the existing
superadmin-pull health check for self-registered instances.

**Errors:**
- `401` — unknown / revoked key → instance should re-register
- `403` — instance `status='deactivated'` → stop heartbeating

### FR-5: Approval Workflow

New status: `awaiting_approval`.

When `environment='production'` or `'staging'`, registration creates the row
with `status='awaiting_approval'`. The instance can heartbeat but the
superadmin treats it as **not yet active** — cross-instance queries, event
ingestion, and platform-events fan-out are blocked until approved.

`environment='dev'` auto-activates (`status='active'`) for friction-free
local dev.

**UI:** new section on `/superadmin/instances` titled "Awaiting Approval" with
**Approve** and **Reject** actions. Approve → `status='active'`. Reject →
`status='deactivated'`, key revoked.

### FR-6: Bootstrap Token Management

`PLATFORM_REGISTRATION_TOKEN` env var on superadmin (single value).
Compared with constant-time equality to the value in the registration request.

Rotation:
1. Operator sets a new token on the superadmin (and via env on new instances).
2. Existing instances are unaffected — they use per-instance `apiKey`, not the bootstrap token.
3. After rotation, old token is dead; any instance still trying to register with it gets `401`.

Optional `PLATFORM_REGISTRATION_ENABLED=false` to globally block new registrations.

### FR-7: Rate Limiting on `/api/instances/register`

- 5 requests per IP per minute (configurable via `REGISTRATION_RATE_LIMIT`).
- Rate limit applies per source IP; successful registrations refill the bucket.
- 429 responses include `Retry-After`.

---

## 7. API Design Summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/instances/register` | bootstrap token (body) | First-time + idempotent self-registration |
| `POST` | `/api/instances/heartbeat` | `X-Instance-Key` | Periodic liveness + version reporting |
| `POST` | `/api/superadmin/instances/:id/approve` | admin JWT | Operator-side approval (new) |
| `POST` | `/api/superadmin/instances/:id/reject` | admin JWT | Operator-side rejection (new) |

The existing `POST /api/superadmin/instances` (manual create) stays untouched
for the air-gapped / R1-15 path.

---

## 8. Data Model Changes

### `instances` table (superadmin DB)

| Column | Change | Notes |
|--------|--------|-------|
| `status` | extend enum | add `awaiting_approval` |
| `registration_source` | **new** `varchar` | `manual` (R1-15) or `self_registered` (R1-16); default `manual` |
| `first_registered_at` | **new** `timestamptz` | When the first successful self-registration POST landed |
| `last_heartbeat_at` | **new** `timestamptz` | Distinct from `last_health_check` (pull); only set by FR-4 |
| `approved_by` | **new** `uuid` | FK to `super_admins.id`; null for `manual` rows |
| `approved_at` | **new** `timestamptz` | |

### `platform_registration` table (EA instance DB)

New, instance-local. See FR-1.

---

## 9. Architecture / Implementation Notes

### Sequence — Happy path (dev)

```
EA Instance                          Superadmin
    |                                    |
    | (boot) gen instanceId locally     |
    |                                    |
    |-- POST /api/instances/register -->|
    |     { instanceId, env=dev, ... }  |
    |                                    |--> insert row, status=active
    |                                    |--> generate apiKey, encrypt, store
    |<-- 201 { apiKey, status=active }--|
    |                                    |
    | persist apiKey locally            |
    |                                    |
    |-- POST /api/instances/heartbeat ->|  (every 60s)
    |     X-Instance-Key: <apiKey>      |
    |<-- 200 { status: active } --------|
```

### Sequence — Production with approval

```
EA Instance                          Superadmin
    |-- register (env=production) ---->|--> status=awaiting_approval
    |<-- 201 { apiKey, awaiting_approval }
    | (heartbeats start)                |
    |-- heartbeat -->                   |--> last_heartbeat_at updated
    |                                    |     but cross-instance reads blocked
    |                                    |
    |                                    | (operator clicks Approve)
    |                                    |--> status=active
    |-- heartbeat -->                   |
    |<-- 200 { status: active } --------|
```

### Sequence — Superadmin unreachable at boot

```
EA Instance                          Superadmin (down)
    |-- register --> (connection refused)
    |   wait 5s
    |-- register --> (connection refused)
    |   wait 10s
    |-- register --> (connection refused)
    |   wait 30s
    |   ...
    |                                    (superadmin comes up)
    |-- register -->                    |--> 201 { apiKey, status }
    | (heartbeats begin)
```

### Security model

| Concern | Mitigation |
|---------|-----------|
| Rogue instance self-registers | Bootstrap token + production approval gating + per-IP rate limit |
| Bootstrap token leaks | Rotation does not invalidate existing instance keys; approval gating limits impact |
| Replay of registration request | `instanceId` is idempotent; second call returns no `apiKey` |
| Instance steals another's identity | `409` on `instanceId` collision with mismatched `url` |
| Compromised instance | Operator deactivates → key revoked → instance gets 403 on next heartbeat |
| MITM | HTTPS required for `SUPERADMIN_URL` in production (validated at config load) |

---

## 10. UI/UX Requirements

### `/superadmin/instances` — new "Awaiting Approval" panel

```
┌─────────────────────────────────────────────────────────────────┐
│ Awaiting Approval (2)                                           │
├─────────────────────────────────────────────────────────────────┤
│ rezonator-prod-eu-1  · https://acme.df.ai  · v1.4.2             │
│   First seen: 2026-05-17 14:22 · Last heartbeat: 14s ago        │
│   [ Approve ]  [ Reject ]                                       │
├─────────────────────────────────────────────────────────────────┤
│ rezonator-staging-1  · https://staging.df.ai · v1.5.0-rc        │
│   ...                                                           │
└─────────────────────────────────────────────────────────────────┘
```

Active instances list shows a small badge (`SELF`) on `registration_source='self_registered'` rows.

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| Bootstrap token in transit | HTTPS-only in prod (enforced); plaintext localhost permitted for `dev` |
| Bootstrap token at rest | Env var only; never logged, never returned by any API |
| Per-instance API key | Reuses R1-15 encryption (AES-256-GCM, encryption key from secret manager) |
| Audit trail | `instance.self_registered`, `instance.approved`, `instance.rejected` events to `admin_audit_log` |
| Rate limiting | FR-7 plus structured logs to detect token-brute-force |
| Re-registration loop guard | If a single `instanceId` re-registers >3 times in 10 minutes, mark as `quarantined` and alert |

---

## 12. Out of Scope

- Auto-deprovisioning silent instances (operator decision)
- Mutual TLS / workload identity federation
- Replacing the existing manual flow (kept for air-gapped on-prem)
- DNS / mDNS discovery of the superadmin

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Bootstrap token: single global vs per-environment? | one / three (`dev`/`staging`/`prod`) | **per-environment**, so a leaked dev token can't register a prod instance |
| Heartbeat interval | 30s / 60s / 5m | **60s** — fast enough for "down" detection, low overhead |
| Should approval be required for `staging`? | yes / no | **yes** — only `dev` auto-approves |
| What happens if instance loses its local DB? | Re-register as new (`409` on URL) / operator must delete old row | **operator deletes old row**, then instance gets new identity on next boot |
| Quarantine threshold (re-register loop) | 3 / 5 / 10 in 10min | **3 in 10min** — anything beyond is likely misconfig |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| R1-07 (Instance Registry) | Spec | Reuses `instances` table; extends with new columns |
| R1-15 (Instance Authentication) | Spec | Reuses per-instance API key crypto + `X-Platform-Key` pattern |
| `INSTANCE_CREDENTIALS_ENCRYPTION_KEY` | Secret | Same key as R1-15 for `api_key_encrypted` |
| `PLATFORM_REGISTRATION_TOKEN` (new) | Secret | Per-environment bootstrap token |

---

## 15. Linked Specs

- **R1-07** — Instance Registry (data model owner)
- **R1-13** — Instance Provisioning & Onboarding (superadmin-side wizard; complementary, not replaced)
- **R1-15** — Instance Authentication (key crypto; this spec adds a second auth surface)
- **R1-14** — Platform Event Bus (registered instances become event publishers)

---

## 16. Implementation Plan

Phased so each phase is independently shippable.

### Phase 1 — Superadmin: registration + heartbeat endpoints
- Migration: extend `instances.status` enum, add new columns (§8 schema).
- New service: `src/lib/services/instance-registration.ts` with `registerOrUpsert()` and `recordHeartbeat()`.
- New routes: `src/app/api/instances/register/route.ts`, `src/app/api/instances/heartbeat/route.ts`.
- Rate limit middleware on `/register`.
- Env: `PLATFORM_REGISTRATION_TOKEN`, `PLATFORM_REGISTRATION_ENABLED`.
- Unit + integration tests (Jest) covering AC1, AC4, AC5, AC7, AC9.

### Phase 2 — Superadmin: approval UI
- New routes: `POST /api/superadmin/instances/:id/approve|reject`.
- UI section on `/superadmin/instances` for `awaiting_approval` rows.
- Audit events for approve/reject.
- E2E test covering AC4.

### Phase 3 — Rezonator client module
- New NestJS module: `PlatformRegistrationModule` in rezonator.
- `platform_registration` migration in rezonator's DB.
- `RegistrationService` with retry/backoff, persistent `instanceId`.
- `HeartbeatService` started post-boot, NOT a hard dependency for app start.
- 401 → clear key → re-register loop.
- Env config: `SUPERADMIN_URL`, `PLATFORM_REGISTRATION_TOKEN`, `INSTANCE_NAME`, `INSTANCE_ENVIRONMENT`, `INSTANCE_PUBLIC_URL`.
- Integration tests covering AC2, AC3, AC6.

### Phase 4 — Migration of existing flows
- Update local dev docs (rezonator CLAUDE.md + this repo's CLAUDE.md) to describe self-registration as the default.
- Keep manual `POST /api/superadmin/instances` working for air-gapped flow.
- Add `registration_source` filter to the list UI.

### Phase 5 — Quarantine + observability
- Re-register loop guard (FR-7 + Security table).
- Metrics: `instances.registration_attempts`, `instances.heartbeats_received`, `instances.quarantined_total`.
- Alert when an `awaiting_approval` instance sits >7 days.

---

## 17. Verification & Testing

| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Cold-boot rezonator with valid token → instance row created | row exists, status per env | E2E |
| TC2 | Cold-boot rezonator with superadmin down → app starts, registers after superadmin recovers | no boot failure; row appears | Integration |
| TC3 | Backoff schedule matches spec (5/10/30/60/300 ± jitter) | timing within ±20% | Unit (fake timers) |
| TC4 | Duplicate registration with same instanceId → 200, no new row, no apiKey in response | confirmed | Unit |
| TC5 | Heartbeat with revoked key → 401 → instance re-registers | new key issued; loop recovers | Integration |
| TC6 | Bad bootstrap token → 401 + rate limited after N attempts | 429 with Retry-After | Security |
| TC7 | Approve flow flips status + emits audit event | `instance.approved` in `admin_audit_log` | E2E |
| TC8 | Reject flow deactivates + revokes key | next heartbeat gets 403 | E2E |
| TC9 | Bootstrap token rotation does not break existing heartbeats | continued 200s | Integration |
| TC10 | `dev` instance auto-activates; `production` does not | confirmed per status | E2E |
