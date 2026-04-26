# R1-14 — Platform Event Bus (Pub/Sub Subscriber & Event Store)

**Spec ID:** R1-14  
**Title:** Platform Event Bus — Google Cloud Pub/Sub Subscriber & Event Store  
**Release:** R1  
**Priority:** P1  
**Status:** ⬜ Not Started  
**Created:** 2026-04-25  
**Updated:** 2026-04-25  
**Spec Owner:** TBD  
**Backlog Ref:** P10-superadmin

---

## 1. Feature Overview

The **Platform Event Bus** is the cross-deployment event ingestion pipeline that powers the superadmin's observability surface (R1-06) and the cross-instance views (R1-08, R1-09). Every registered EA instance (R1-07) publishes platform-significant events to a single Google Cloud Pub/Sub topic owned by the superadmin GCP project. The superadmin app subscribes to that topic, persists envelopes to its own database, and exposes the resulting stream to the activity log, alerting, and analytics surfaces.

This spec covers the **subscriber side**: topic ownership, subscription configuration, the event envelope contract, ingest endpoint, persistence schema, retention/archival, alerting, and the dev-mode HTTP fallback. The publisher side (which events are emitted, how they are filtered, and how the EA app pushes to Pub/Sub) is defined in **Rezonator S095 — Platform Event Publisher**.

### Why Pub/Sub?

| Requirement | Pub/Sub fit |
|---|---|
| Many publishers (every EA instance), one consumer (superadmin) | Native fan-in; topic is single source of truth |
| Decoupled lifecycle — superadmin can be down for maintenance without losing events | At-least-once delivery + 7-day default retention |
| At-least-once delivery with replay | Built-in; supports seek + dead-letter topics |
| Per-instance authentication, per-message attributes for routing | Service account auth + message attributes |
| Mixed deployments (SaaS, on-prem, cloud-managed) need a network-friendly transport | HTTPS publisher API; works across customer networks (no inbound firewall holes) |
| Predictable cost at low volume | First 10 GiB/month free; pennies thereafter |

### Architecture Overview (ASCII)

```
┌────────────────────────────────────────────────────────────────────────┐
│  EA Instance A (df-prod-eu / Acme on-prem / Beta cloud-managed / …)    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PlatformEventPublisher  (rezonator S095)                       │   │
│  │  - listens to internal @nestjs/event-emitter events              │   │
│  │  - filters platform-significant events                          │   │
│  │  - signs + envelopes + publishes                                │   │
│  └────────────────────────┬────────────────────────────────────────┘   │
└───────────────────────────┼────────────────────────────────────────────┘
                            │  HTTPS (gRPC) PublisherClient.publish(...)
                            │  service account: instance-publisher@<instance-gcp>
                            ▼
              ┌──────────────────────────────────────────┐
              │  GCP Project: df-superadmin-prod         │
              │  ┌────────────────────────────────────┐  │
              │  │  Topic: platform-events            │  │
              │  │  attributes: instanceId,           │  │
              │  │              eventType, severity   │  │
              │  └──────────────┬─────────────────────┘  │
              │                 │                        │
              │                 ▼                        │
              │  ┌────────────────────────────────────┐  │
              │  │  Push subscription                 │  │
              │  │  superadmin-events-ingest          │  │
              │  │  ack-deadline: 30s                 │  │
              │  │  message-retention: 7 days         │  │
              │  │  dead-letter: platform-events-dlq  │  │
              │  │  max-deliveries: 5                 │  │
              │  └──────────────┬─────────────────────┘  │
              └─────────────────┼────────────────────────┘
                                │  POST /api/v1/superadmin/events/ingest
                                │  Authorization: Bearer <OIDC token>
                                ▼
              ┌──────────────────────────────────────────┐
              │  Superadmin (designfoundry-superadmin)   │
              │  EventIngestController                   │
              │  ├── verify OIDC token (service account) │
              │  ├── verify HMAC signature on envelope   │
              │  ├── verify instanceId ∈ instances (R1-07) │
              │  ├── upsert into platform_events table   │
              │  └── enqueue alert job if severity ≥ error│
              └──────────────────────────────────────────┘
```

The flow is **EA instance → Pub/Sub topic (in superadmin GCP project) → push subscription → superadmin ingest endpoint → `platform_events` table**. From there R1-06 reads it for the Activity Log surface, R1-09 reads it for cross-instance dashboards, and an alerting job (this spec, §FR-7) escalates `error`/`critical` events to operators.

---

## 2. Goals

- [ ] **Single Pub/Sub topic** `platform-events` in the superadmin GCP project receives events from every registered EA instance
- [ ] **Standardized event envelope** — versioned JSON schema with id, instanceId, tenantId, eventType, severity, actor, payload, timestamp
- [ ] **Push subscription** to a superadmin HTTPS ingest endpoint with OIDC token auth
- [ ] **Pull subscription option** — long-running consumer for environments where push is undesirable
- [ ] **Persistent event store** — `platform_events` table in superadmin DB
- [ ] **Idempotent ingest** — duplicate Pub/Sub deliveries deduped on event `id`
- [ ] **Severity-driven alerting** — `error` and `critical` events trigger immediate operator notification
- [ ] **Retention policy** — 90 days hot in DB, archived to GCS thereafter
- [ ] **Dev fallback** — when Pub/Sub is unavailable (CI / local), accept direct HTTP POSTs from EA instances
- [ ] **Instance verification** — every event's `instanceId` is checked against the Instance Registry (R1-07) before persistence

---

## 3. Non-Goals

- Per-tenant audit log (the per-tenant `audit_log` lives inside each EA instance — this stream is platform-significant only)
- Replay or backfill UI (operators use `gcloud pubsub subscriptions seek` directly for now)
- Real-time streaming to the admin UI (R1-06 polls `platform_events` every 30s — WebSocket push deferred)
- Cross-region geo-replication of the topic (single global topic for R1)
- Event sourcing / aggregate reconstruction (events are observational, not authoritative state)
- High-volume per-action telemetry (object created, comment added, etc.) — these stay inside the EA instance and are only visible via aggregated `usage.daily_summary` events

---

## 4. User Story

> As a **Platform Operator**,  
> I want every significant event from every EA deployment to land in one place — without each instance having to know how to reach the superadmin directly,  
> so that I can investigate incidents, audit security events, and watch usage trends across the entire platform from a single console.

> As a **Customer Success Engineer**,  
> I want to see when a tenant on any deployment hit a license expiry, suspended a user, or generated platform errors,  
> so that I can pre-emptively reach out to the customer before they file a ticket.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification | Test Scenario |
|----|-----------|--------------|---------------|
| AC1 | Pub/Sub topic `platform-events` exists in `df-superadmin-prod` with attributes `instanceId`, `eventType`, `severity` | Inspection | `gcloud pubsub topics describe platform-events` |
| AC2 | Push subscription delivers messages to ingest endpoint and acks on 200 | Integration | Publish synthetic event → row appears in `platform_events` within 5s |
| AC3 | Duplicate delivery (same envelope `id`) results in exactly one row | Integration | Publish same envelope twice → 1 row, 2 deliveries observed in metrics |
| AC4 | Ingest rejects events from `instanceId` not in `instances` registry with 403 | Integration | POST envelope with bogus instanceId → 403; row not written |
| AC5 | Ingest rejects envelopes with invalid HMAC signature with 401 | Integration | POST envelope with mutated payload → 401 |
| AC6 | `error`/`critical` events trigger an operator notification (email/Slack/in-app) within 60s | Integration | Publish `system.error` → operator inbox shows alert |
| AC7 | Events older than 90 days are archived to GCS bucket and removed from `platform_events` | Integration | Insert 91-day-old row → nightly job moves to GCS, row deleted |
| AC8 | Dev fallback: `POST /api/v1/superadmin/events/ingest` accepts envelopes signed with shared secret when `PUBSUB_INGEST_MODE=direct` | Unit | Direct POST works without OIDC token |
| AC9 | Schema version mismatch (envelope `version` ≠ supported) is logged and dropped to DLQ | Integration | Publish envelope with `version: "9.9"` → row in DLQ, none in `platform_events` |
| AC10 | Activity Log surface (R1-06) reads from `platform_events` for cross-instance events | E2E | Synthetic event → appears in `/superadmin/activity` |

---

## 6. Functional Requirements

### FR-1: Pub/Sub Topology

**One topic, one production subscription, one DLQ.**

| Resource | Name | Notes |
|---|---|---|
| Topic | `projects/df-superadmin-prod/topics/platform-events` | All EA instances publish here |
| Subscription (push) | `projects/df-superadmin-prod/subscriptions/superadmin-events-ingest` | Pushes to `https://superadmin.designfoundry.ai/api/v1/superadmin/events/ingest` |
| Subscription (pull, optional) | `projects/df-superadmin-prod/subscriptions/superadmin-events-pull` | Used when push is disabled (e.g. air-gapped staging) |
| Dead-letter topic | `projects/df-superadmin-prod/topics/platform-events-dlq` | Receives messages after 5 failed deliveries |
| DLQ subscription | `projects/df-superadmin-prod/subscriptions/platform-events-dlq-inspect` | Pull subscription for operator triage |

**Subscription configuration:**

| Setting | Value | Rationale |
|---|---|---|
| Ack deadline | 30 seconds | Ingest handler is < 1s typical; 30s leaves room for DB blips |
| Message retention | 7 days | Allows superadmin to be down for a week without data loss |
| Max delivery attempts | 5 | After 5 failures → DLQ (DB schema mismatch, app bug, etc.) |
| Push auth | OIDC token | Service account `pubsub-push@df-superadmin-prod.iam.gserviceaccount.com`; ingest verifies audience |
| Ordering | Disabled | Ordering would require ordering keys per instance; not needed — `timestamp` field used for ordering at read time |
| Exactly-once | Disabled | At-least-once + idempotent ingest is simpler and cheaper |

**Message attributes (for filtering/observability without parsing the body):**

| Attribute | Example | Purpose |
|---|---|---|
| `instanceId` | `df-prod-eu` | Routing/filtering, surfaced in Pub/Sub metrics by instance |
| `eventType` | `tenant.suspended` | Filter subscription by type if we ever add per-type subscriptions |
| `severity` | `critical` | Future: separate high-priority push subscription for critical events |
| `schemaVersion` | `1` | Drop on schema mismatch before parsing the body |

### FR-2: Event Envelope Schema

Every published message is a JSON envelope:

```json
{
  "id": "01J5X9Y8Z7W6V5U4T3S2R1Q0P9",
  "version": "1",
  "instanceId": "df-prod-eu",
  "tenantId": "8f7e6d5c-4b3a-2918-1716-151413121110",
  "eventType": "user.login_failed",
  "severity": "warning",
  "actor": {
    "userId": "a1b2c3d4-...",
    "email": "user@acme.com",
    "ipAddress": "203.0.113.42"
  },
  "payload": {
    "reason": "INVALID_PASSWORD",
    "attemptCount": 3,
    "userAgent": "Mozilla/5.0 ..."
  },
  "timestamp": "2026-04-25T10:00:00.123Z",
  "signature": "sha256=8fa2b...",
  "signatureKid": "instance-key-2026-04"
}
```

**Field definitions:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | ULID string | yes | Globally unique; used for idempotency. ULID encodes timestamp + randomness. |
| `version` | string | yes | Envelope schema version. R1 = `"1"`. |
| `instanceId` | string | yes | Matches `instances.id_slug` from R1-07. Verified at ingest. |
| `tenantId` | uuid string | no | Null for instance-level / system events (e.g. `system.error`, `instance.started`). |
| `eventType` | string enum | yes | See §FR-3. Dotted namespace: `<category>.<verb>`. |
| `severity` | enum | yes | `info` / `warning` / `error` / `critical`. |
| `actor.userId` | uuid string | no | Null for system-triggered events. |
| `actor.email` | string | no | Denormalized for searchability without joining instance DB. |
| `actor.ipAddress` | string | no | IPv4/IPv6; redacted to `/24` mask in payload retention. |
| `payload` | object | yes | Event-specific. Schema documented per type (FR-3). May be `{}`. |
| `timestamp` | ISO-8601 | yes | Generated by publisher at the moment of emission. |
| `signature` | string | yes | `sha256=<hex>` HMAC of canonical envelope (excluding `signature` + `signatureKid`) using instance HMAC key. |
| `signatureKid` | string | yes | Identifier of the HMAC key used; supports rotation. |

**Canonical signing form:** the envelope is serialized with sorted keys, no whitespace, then HMAC-SHA256 with the instance's signing secret. Secret is per-instance, stored encrypted in `instances.signing_secret` (R1-07 extension), distributed at instance registration time.

### FR-3: Event Type Catalog

Event types follow the `<category>.<verb>` convention. `payload` schema is type-specific. R1 ships with these categories:

#### Security (severity: `info` for success, `warning` for failed/changed, `critical` for compromise indicators)

| Event Type | severity | Required payload fields |
|---|---|---|
| `user.login` | `info` | `method` (password/oauth/saml), `success`: true |
| `user.login_failed` | `warning` | `reason`, `attemptCount`, `userAgent` |
| `user.password_changed` | `info` | `triggeredBy` (self/admin/reset_token) |
| `user.role_changed` | `warning` | `targetUserId`, `oldRole`, `newRole` |
| `user.invited` | `info` | `invitedEmail`, `role` |
| `user.removed` | `warning` | `removedUserId`, `removedEmail`, `reason` |

#### Tenant lifecycle (severity: `info` unless customer-impacting)

| Event Type | severity | Required payload fields |
|---|---|---|
| `tenant.created` | `info` | `name`, `plan`, `region` |
| `tenant.suspended` | `warning` | `reason`, `suspendedBy` |
| `tenant.activated` | `info` | `activatedBy` |
| `tenant.deleted` | `critical` | `deletedBy`, `dataRetentionDays` |
| `tenant.plan_changed` | `info` | `oldPlan`, `newPlan`, `effectiveAt` |

#### Platform (license + content packs)

| Event Type | severity | Required payload fields |
|---|---|---|
| `license.activated` | `info` | `licenseId`, `tier`, `validUntil` |
| `license.expired` | `warning` | `licenseId`, `expiredAt` |
| `license.revoked` | `error` | `licenseId`, `revokedBy`, `reason` |
| `license.delivered` | `info` | `licenseId`, `licenseJwt` (base64), `validUntil`, `tier` |
| `content_pack.activated` | `info` | `packId`, `packVersion` |
| `content_pack.deactivated` | `info` | `packId`, `reason` |

**Direction convention:** `license.activated`, `license.expired`, `license.revoked` are published by the EA instance to the superadmin (upstream events). `license.delivered` is published by the superadmin to the EA instance (downstream delivery). All use the same topic.

### FR-3.1: License Delivery via Pub/Sub (Superadmin → EA Instance)

License delivery uses the same Pub/Sub topic to push licenses from the superadmin to registered EA instances. This replaces manual `.lic` file transfer for SaaS and cloud-managed tenants.

**Flow:**
```
Superadmin generates license (POST /api/licenses)
    → writes license to superadmin DB (licenses table)
    → for saas/deliveryModel=saas tenants: publishes `license.delivered` to Pub/Sub topic
    → Pub/Sub pushes to EA instance's subscriber
    → EA instance verifies JWT signature using superadmin's public key (fetched from well-known URL)
    → stores license in local DB / file system
    → enforces limits based on license claims
```

**Publishing trigger:** When a new license is created (`POST /api/licenses`) and `delivery_model = 'saas'`, the superadmin publishes a `license.delivered` event to the topic. The `instanceId` is derived from the tenant's registered EA instance (from `instances` table, R1-07).

**Subscription:** EA instances subscribe to the topic using a push subscription pointing to `https://<ea-instance>/api/v1/superadmin/events/ingest` OR a pull subscription from within the EA network. Each instance receives all `license.delivered` events and filters by `payload.tenantId` matching its own tenant.

**On-prem fallback:** Tenants with `delivery_model = 'on_prem'` are not delivered via Pub/Sub. Admin downloads the `.lic` file from superadmin UI and transfers it manually to the on-prem server.

**Security model:**
- Superadmin publishes to the topic using its own service account (`designfoundry-superadmin@...`)
- No shared secret between superadmin and EA instances
- EA instances verify the license JWT using the superadmin's RSA public key (fetched from `https://superadmin.designfoundry.ai/.well-known/superadmin-public-key.pem`)
- JWT verification (RS256) is the only trust mechanism — HMAC envelope signature is verified normally per FR-4 step 5

**Pub/Sub topic:** same `platform-events` topic as upstream events. The direction (superadmin → instance) is indicated by `eventType` = `license.delivered`.

**EA instance license refresh handler (new endpoint):**
```
POST /api/v1/superadmin/events/ingest
```
The same ingest endpoint handles `license.delivered` events. The EA instance's handler extracts `payload.licenseJwt` and stores it locally.

**License JWT structure (from `src/lib/license.ts`):**
```json
{
  "customerId": "acme-corp",
  "customerName": "Acme Corp",
  "plan": "professional",
  "maxUsers": 100,
  "maxObjects": 5000,
  "features": ["core", "collaboration", "export"],
  "addons": [],
  "deliveryModel": "saas",
  "jti": "01J5X9Y8Z7W6V5U4T3S2R1Q0P",
  "iat": 1714067200,
  "exp": 1745603200,
  "iss": "designfoundry-superadmin"
}
```

**Public key distribution:**
- Well-known URL: `https://superadmin.designfoundry.ai/.well-known/superadmin-public-key.pem`
- EA instances fetch and cache this on startup / daily refresh
- On-prem: public key distributed during installation

#### License Delivery — Event Envelope Example
```json
{
  "id": "01J5X9Y8Z7W6V5U4T3S2R1Q1",
  "version": "1",
  "instanceId": "df-prod-eu",
  "tenantId": "8f7e6d5c-4b3a-2918-1716-151413121110",
  "eventType": "license.delivered",
  "severity": "info",
  "actor": { "userId": null, "email": "superadmin@designfoundry.ai" },
  "payload": {
    "licenseId": "01J5X9Y8Z7W6V5U4T3S2R1Q0P",
    "licenseJwt": "eyJhbGc...",
    "validUntil": "2027-04-26T00:00:00.000Z",
    "tier": "professional"
  },
  "timestamp": "2026-04-26T12:30:00.000Z",
  "signature": "sha256=abc123...",
  "signatureKid": "prod-2026-01"
}
```

#### System (severity: `error` or `critical`)

| Event Type | severity | Required payload fields |
|---|---|---|
| `system.error` | `error` | `errorClass`, `message`, `stack` (truncated 2 KiB), `endpoint` |
| `system.health_degraded` | `warning` | `service`, `status`, `latencyMs`, `errorRate` |
| `instance.started` | `info` | `version`, `commit`, `startedAt` |
| `instance.stopped` | `warning` | `reason` (planned/crash/oom), `uptimeSec` |

#### Usage (aggregated daily — never per-action)

| Event Type | severity | Required payload fields |
|---|---|---|
| `usage.daily_summary` | `info` | `date` (YYYY-MM-DD), `objectsCreated`, `diagramsModified`, `activeUsers`, `storageBytes` |

This is the **only** way per-tenant activity volume reaches the superadmin. Per-action events (`object.created`, `comment.added`, etc.) stay inside the EA instance — see Rezonator S095 §FR-2 for the publisher-side filtering rules.

### FR-4: Push Ingest Endpoint

```
POST /api/v1/superadmin/events/ingest
Content-Type: application/json
Authorization: Bearer <Google-issued OIDC token>
```

**Pub/Sub push request body:**

```json
{
  "message": {
    "data": "<base64-encoded envelope JSON>",
    "messageId": "12345",
    "publishTime": "2026-04-25T10:00:00.456Z",
    "attributes": {
      "instanceId": "df-prod-eu",
      "eventType": "user.login_failed",
      "severity": "warning",
      "schemaVersion": "1"
    }
  },
  "subscription": "projects/df-superadmin-prod/subscriptions/superadmin-events-ingest"
}
```

**Handler steps:**

1. **OIDC verification** — verify the bearer token's signature, audience (`https://superadmin.designfoundry.ai/api/v1/superadmin/events/ingest`), and issuer (`https://accounts.google.com`). Reject 401 on failure.
2. **Schema version check** — if `attributes.schemaVersion` is not in supported set (`["1"]`), return 200 to ack (drop), but log a warning. Pub/Sub will not redeliver.
3. **Decode + parse envelope** — base64 decode `message.data`; JSON parse. On parse error → 200 (drop), log error, increment `event_ingest_drop_total{reason="parse"}`.
4. **Instance verification** — look up envelope `instanceId` in `instances` table (R1-07). If not found or `status != active`, return 403; Pub/Sub will retry up to 5× and dead-letter.
5. **Signature verification** — recompute HMAC using `instances.signing_secret` and compare. On mismatch → 401, drop to DLQ.
6. **Idempotent insert** — `INSERT INTO platform_events ... ON CONFLICT (id) DO NOTHING`. If conflict (duplicate), return 200 immediately.
7. **Severity routing** — if severity ∈ {`error`, `critical`}, enqueue `platform-event-alert` BullMQ job (FR-7).
8. **Return 200** — Pub/Sub acks the message.

**Latency target:** P50 < 50 ms, P99 < 250 ms. The ingest path must not query the EA instance DB or any external service synchronously.

### FR-5: Pull Subscription Consumer (Optional)

For environments where push delivery is undesirable (e.g. local dev, air-gapped staging without public ingress), the superadmin app can run a **pull consumer**:

- Started when env var `PUBSUB_PULL_ENABLED=true`
- Uses `@google-cloud/pubsub` `subscription.on('message', ...)` API
- Same envelope-validation + persistence logic as the push handler (extracted into `EventIngestService`)
- One worker per superadmin instance (BullMQ-coordinated leader election to avoid double-processing)

In production we run **push only**. Pull is for fallback and local dev.

### FR-6: Event Storage — `platform_events` Table

See §8.

### FR-7: Severity Alerting

When an event with `severity ∈ {error, critical}` lands:

1. Enqueue a `platform-event-alert` BullMQ job with the event ID
2. Job handler:
   - Re-reads the event row (in case of retry)
   - Constructs an alert payload (event type, severity, instance name from R1-07, tenant name if any, summary, deep-link to `/superadmin/activity?eventId=<id>`)
   - Dispatches via the Notification Service (Rezonator S054 — but the superadmin runs its own minimal port; see §9)
   - **Critical** → email + Slack to `#df-platform-incidents`, in-app notification to all operators
   - **Error** → email + in-app notification, Slack only if 5+ errors in 10-minute window (rate-limited)
3. **Deduplication** — if the same `(eventType, instanceId, severity)` triple has fired in the last 5 minutes, suppress the outbound notification (still write the in-app entry). Prevents alert storms from the same root cause.

### FR-8: Retention & Archival

- **Hot tier:** 90 days in `platform_events` table
- **Cold tier:** GCS bucket `df-superadmin-prod-platform-events-archive`
- Daily archival job (BullMQ repeatable, 03:00 UTC):
  1. Select rows where `received_at < NOW() - INTERVAL '90 days'`
  2. Group by date and instance, write to GCS as newline-delimited JSON: `gs://.../date=YYYY-MM-DD/instance=<id>/events.ndjson.gz`
  3. Delete archived rows in batches of 10 000
  4. Record archive metadata in `platform_event_archives` (date, instance_id, gcs_uri, row_count, archived_at)
- **Critical events exemption** — events with `severity = critical` are kept in DB for 365 days regardless of age (operator quick-access)
- Archive bucket lifecycle: nearline after 30 days, coldline after 180, deletion after 7 years (compliance)

### FR-9: Dev / CI Fallback

Pub/Sub emulator is acceptable for local dev but adds setup friction. For developers who want to bypass it:

- Env var `PUBSUB_INGEST_MODE` = `pubsub` (default) | `direct` | `disabled`
- When `direct`:
  - Ingest endpoint accepts envelopes posted directly by the EA instance (no Pub/Sub envelope wrapping)
  - Auth via shared secret header `X-Ingest-Secret: <DEV_INGEST_SECRET>` (env var)
  - HMAC envelope signature still verified
  - Useful for developer machines pointing at a local superadmin
- When `disabled`:
  - Ingest endpoint returns 503; events from EA must be discarded or queued

The publisher side (S095) has its own `PUBSUB_ENABLED` toggle — when disabled, it can either log to console or POST to `SUPERADMIN_WEBHOOK_URL`. The two specs together provide a fully Pub/Sub-free dev path.

---

## 7. API Design

### POST /api/v1/superadmin/events/ingest

Receives Pub/Sub push deliveries. **Internal**: not surfaced in any public OpenAPI. Authentication varies by `PUBSUB_INGEST_MODE`.

#### Request (Pub/Sub mode)

```http
POST /api/v1/superadmin/events/ingest
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "message": {
    "data": "<base64 envelope>",
    "messageId": "12345",
    "publishTime": "2026-04-25T10:00:00.456Z",
    "attributes": { "instanceId": "df-prod-eu", "eventType": "user.login", "severity": "info", "schemaVersion": "1" }
  },
  "subscription": "projects/df-superadmin-prod/subscriptions/superadmin-events-ingest"
}
```

#### Request (Direct mode)

```http
POST /api/v1/superadmin/events/ingest
X-Ingest-Secret: <shared secret>
Content-Type: application/json

{ ...envelope... }
```

#### Responses

| Code | Meaning | Pub/Sub effect |
|---|---|---|
| 200 | Accepted (or duplicate, or dropped on schema mismatch) | Ack — no redelivery |
| 401 | Missing/invalid OIDC token or HMAC signature | Nack — redeliver up to 5× then DLQ |
| 403 | Unknown / inactive `instanceId` | Nack — redeliver up to 5× then DLQ |
| 413 | Envelope > 256 KiB | Ack (drop) — log to ingest_drop metric |
| 500 | Unexpected server error | Nack — redeliver |

### GET /api/v1/superadmin/events

Operator-facing list endpoint backing R1-06's Activity Log. See R1-06 §7 for the full schema. This endpoint reads from the `platform_events` table written by this spec.

### GET /api/v1/superadmin/events/dlq

Lists messages currently in the DLQ subscription with payload + failure reason. Operator triage tool.

#### Response 200 OK
```json
{
  "messages": [
    {
      "messageId": "12345",
      "publishTime": "2026-04-25T10:00:00.456Z",
      "attributes": { "instanceId": "df-prod-eu", "eventType": "...", "severity": "error", "schemaVersion": "9.9" },
      "data": "<base64 envelope>",
      "deliveryAttempt": 5,
      "lastError": "Schema version 9.9 not supported"
    }
  ],
  "total": 3
}
```

### POST /api/v1/superadmin/events/dlq/:messageId/replay

Re-publishes a DLQ message to the main topic for re-ingestion (after operator has fixed the underlying issue).

### GET /api/v1/superadmin/events/stats

Returns ingest health: messages/min, P50/P99 latency, drop rate by reason, DLQ depth.

---

## 8. Data Model Changes

### New Entity: `platform_events`

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | varchar(26) | N | — | ULID from envelope; PK |
| `instance_id` | varchar(64) | N | — | Matches `instances.id_slug` (R1-07); indexed |
| `tenant_id` | uuid | Y | — | Tenant context if applicable; indexed |
| `event_type` | varchar(64) | N | — | `<category>.<verb>`; indexed |
| `severity` | varchar(16) | N | `'info'` | `info`/`warning`/`error`/`critical`; indexed |
| `actor_user_id` | uuid | Y | — | |
| `actor_email` | varchar(320) | Y | — | Denormalized for search without joining instance DB |
| `actor_ip_address` | varchar(45) | Y | — | IPv4/IPv6; masked to `/24` after 30 days |
| `payload` | jsonb | N | `'{}'` | Event-specific fields per FR-3 |
| `event_timestamp` | timestamptz | N | — | From envelope (publisher's clock) |
| `received_at` | timestamptz | N | `now()` | When subscriber persisted; indexed |
| `pubsub_message_id` | varchar(64) | Y | — | For correlation with GCP logs |
| `schema_version` | varchar(8) | N | `'1'` | |
| `signature_kid` | varchar(64) | N | — | Which signing key verified the envelope |

**Indexes:**
- PK on `id`
- `(instance_id, event_timestamp DESC)` — primary access pattern (per-instance feed)
- `(tenant_id, event_timestamp DESC)` WHERE `tenant_id IS NOT NULL` — tenant feed
- `(severity, event_timestamp DESC)` WHERE `severity IN ('error', 'critical')` — alert/triage feed
- `(event_type, event_timestamp DESC)` — type filter
- `(received_at)` — retention sweep
- GIN on `payload` (jsonb_path_ops) — rare ad-hoc queries

**Constraints:**
- `severity` CHECK in (`info`, `warning`, `error`, `critical`)
- `event_type` regex CHECK `^[a-z_]+\.[a-z_]+$`

### New Entity: `platform_event_archives`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `archive_date` | date | Date of archived events |
| `instance_id` | varchar(64) | |
| `gcs_uri` | text | `gs://.../date=.../instance=.../events.ndjson.gz` |
| `row_count` | int | |
| `archived_at` | timestamptz | |
| `archive_size_bytes` | bigint | |

Unique on `(archive_date, instance_id)`.

### Existing Entity Changes: `instances` (R1-07)

| Change | Notes |
|--------|-------|
| + `signing_secret` (text) | AES-256-GCM encrypted HMAC secret used to verify envelope signatures; rotated by operator; nullable until first ingest |
| + `signing_kid` (varchar(64)) | Current key ID; matches envelope `signatureKid` |
| + `last_event_received_at` (timestamptz) | Updated on every successful ingest; used by R1-09 to flag silent instances |

### Migration Notes

- Tables created in superadmin DB only — no migration in main app
- `instances` migration is additive (nullable columns); existing rows backfill `signing_secret` lazily on next operator-driven instance edit
- `platform_events` is partitioned by `received_at` (monthly) for cheap retention drops — `pg_partman` recommended

---

## 9. Architecture / Implementation Notes

### Technical Approach

| Concern | Approach |
|---|---|
| GCP client | `@google-cloud/pubsub` v4+ (Node) for pull subscription only; push doesn't need the client |
| OIDC verification | `google-auth-library` `OAuth2Client.verifyIdToken({ audience })` |
| HMAC verification | Node `crypto.createHmac('sha256', secret).update(canonicalForm).digest('hex')` with timing-safe compare |
| Idempotency | DB-level — `INSERT ... ON CONFLICT (id) DO NOTHING`; no app-level cache |
| Alerting transport | Reuse R1-06's notification dispatcher; the superadmin runs a **lightweight** port of S054 (email + Slack + in-app only — no Discord/webhook/quiet-hours complexity needed for ops alerts) |
| Archival | BullMQ repeatable job; `@google-cloud/storage` for GCS uploads; ndjson + gzip |
| Partitioning | Native PostgreSQL declarative partitioning by `received_at` month; `pg_partman` for automated maintenance |
| Tracing | OpenTelemetry — propagate trace context via `traceparent` envelope attribute (added by S095 publisher) |

### Push vs Pull Decision

| Mode | When to use | Cost |
|---|---|---|
| Push (default) | Production — superadmin always reachable on HTTPS | Free; standard Cloud Run scale-from-zero acceptable because `min-instances: 1` already required for Stripe webhooks (S070 §3.5) |
| Pull (optional) | Local dev, staging behind VPN, recovery from outage backlog | Requires long-running worker; adds Redis leader-election complexity |

We ship push as the only production path. Pull is a debugging tool.

### Ordering & Out-of-Order Events

Pub/Sub does not guarantee order. The superadmin sorts by `event_timestamp` (publisher clock) at read time. Acceptable risks:

- Two events from the same instance with the same `event_timestamp` (millisecond collision) — break ties by `id` (ULID)
- Clock skew between instances — superadmin treats all timestamps as published-time-of-truth and never compares timestamps across instances for ordering

### Key Decisions to Resolve

| Decision | Options | Recommendation |
|----------|---------|-----------------|
| Topic per environment | Single `platform-events` (prod-only) vs `platform-events-{prod,staging,dev}` | Per-environment topics — staging events should never land in prod DB |
| Envelope max size | 256 KiB (Pub/Sub limit) vs enforced lower (e.g. 64 KiB) | Hard-reject at 64 KiB at publisher; log+drop at 256 KiB at ingest |
| Per-instance vs per-event-type subscriptions | One subscription, route in app vs N filtered subscriptions | One subscription for R1; revisit if event volume justifies per-type fan-out |
| Signing-key rotation | Operator-triggered vs scheduled | Operator-triggered; `signature_kid` already supports overlap window |
| Replay UI | None / DLQ-only / full time-range replay | DLQ-only for R1 |

---

## 10. UI/UX Requirements

This spec is mostly infrastructure. The user-facing surfaces it powers are defined in R1-06 (Activity Log) and R1-09 (Cross-Instance Observability). Two new operator-only screens belong here:

### Key Screens

| Screen | Purpose | Key Interactions |
|--------|---------|-----------------|
| `/superadmin/system/event-bus` | Ingest pipeline health: messages/min, latency, drop rate, DLQ depth, per-instance ingest counts | Click instance → event feed for that instance; click DLQ depth → DLQ inspector |
| `/superadmin/system/event-bus/dlq` | Dead-letter inspector — decoded envelopes, failure reasons, replay button | Click message → modal with full payload + replay/discard actions |

### Event Bus Health Page (sketch)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Platform Event Bus                                                  │
├──────────────────────────────────────────────────────────────────────┤
│ Ingest Rate:   847 msg/min      P99 latency: 187ms                  │
│ Dropped (24h):   12             DLQ depth:     3 [Inspect]          │
│ Last archive: Apr 25 03:00 — 1.4M events → GCS                      │
├──────────────────────────────────────────────────────────────────────┤
│ Per-Instance (last 1h)                                              │
│ df-prod-eu        🟢 412 msg   last: 4s ago                         │
│ df-prod-us        🟢 287 msg   last: 11s ago                        │
│ acme-onprem       🟡 1   msg   last: 47m ago  (silent? alert)       │
│ beta-cloud        🟢 147 msg   last: 8s ago                         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 11. Security & Compliance

| Concern | Handling |
|---------|----------|
| Topic ACL | Only registered instance service accounts have `roles/pubsub.publisher`; granted at instance registration time (R1-13) |
| Subscription ACL | Only `pubsub-push@df-superadmin-prod` has `roles/pubsub.subscriber`; ingest endpoint validates OIDC audience |
| Envelope integrity | HMAC-SHA256 signature on every envelope, verified at ingest using per-instance secret |
| Instance verification | Every event's `instanceId` validated against `instances` registry (R1-07); rejected if not active |
| Secret distribution | Per-instance HMAC secret generated at instance registration, sent once to operator over secure channel; encrypted at rest (AES-256-GCM, key in GCP Secret Manager) |
| PII in payload | Email addresses preserved for search; IP addresses masked to `/24` after 30 days; payloads scanned for high-entropy strings (potential secrets) — flagged in audit log |
| Audit | Every ingest logged with `(instanceId, eventType, signature_kid, outcome)`; failed signature verifications retained 1 year |
| GDPR | EU events stored in `df-superadmin-prod` running in `europe-west1`; payload may contain user email — qualifies as personal data; 90-day retention satisfies data minimization; tenant-deletion request (`tenant.deleted` event) triggers purge of all events for that tenant ID after a 30-day operator hold |
| DORA / NIS2 | This stream is the cross-deployment incident telemetry feed; `system.error` and `system.health_degraded` events are mandatory inputs for incident response under DORA Art. 17 reporting |
| Replay protection | Envelope `id` (ULID) is unique; second insert ignored — replay attacks cannot create duplicate state |
| Rate limiting | Per-instance ingest limit: 1000 msg/min sustained, 5000 msg/min burst; enforced via leaky-bucket keyed on `instanceId`; excess returns 429 → Pub/Sub backs off |

---

## 12. Out of Scope

- Per-tenant audit log (lives in EA instance — see Rezonator S054 §9.5 `email_audit_log` and the per-tenant `audit_log` from S008/S070)
- Per-action telemetry (object/comment/diagram events) — only `usage.daily_summary` aggregates reach the superadmin
- Real-time WebSocket push from superadmin to operator browsers (R1-06 polls)
- Cross-region geo-replication of the topic
- External SIEM forwarding (Splunk/Datadog) — Phase 2
- Event sourcing / state reconstruction — events are observational
- Customer-facing event API (tenants do not see this stream)

---

## 13. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Signing key rotation cadence | 90d / 180d / 365d / on-demand only | On-demand for R1; revisit if compliance requires rotation |
| Should `usage.daily_summary` be 1 event per tenant or 1 event per instance with all-tenants array? | Per-tenant (more events, simpler schema) vs per-instance (fewer events, complex schema) | Per-tenant — keeps event size small and downstream queries simple |
| DLQ replay UI | Just-list / replay-individual / replay-time-range | Replay-individual for R1; time-range deferred |
| Critical events: in-app push or PagerDuty? | In-app + email + Slack vs add PagerDuty integration | In-app + email + Slack for R1; PagerDuty deferred to alerting Phase 2 |
| Payload size hard cap | 64 KiB / 128 KiB / 256 KiB (Pub/Sub max) | 64 KiB enforced at publisher; 256 KiB drop at ingest |
| Per-environment topic isolation | Yes / no | Yes — `platform-events`, `platform-events-staging`, `platform-events-dev` |

---

## 14. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| GCP Pub/Sub | External | Topic + subscriptions in `df-superadmin-prod` |
| GCP Cloud Storage | External | Archive bucket |
| GCP Secret Manager | External | Encryption key for `instances.signing_secret` |
| R1-07 (Instance Registry) | Required | Instance verification + signing secret storage |
| R1-06 (Observability) | Consumer | Activity Log reads `platform_events` |
| R1-09 (Cross-Instance Observability) | Consumer | Aggregate dashboards read `platform_events` |
| R1-13 (Instance Provisioning) | Required | New instance onboarding generates signing secret + grants `roles/pubsub.publisher` |
| **Rezonator S095** (Platform Event Publisher) | Required (publisher side) | EA app emits envelopes to this topic |
| BullMQ + Redis | Required | Alert dispatcher + archival job + retention sweep |
| `@google-cloud/pubsub` | Library | Pull consumer (optional) |
| `google-auth-library` | Library | OIDC verification on push endpoint |

---

## 15. Linked Specs

- **Rezonator S095** — Platform Event Publisher — defines the publisher side of this contract; envelope schema is mirrored
- **R1-06** (Observability) — consumes `platform_events` for Activity Log surface; this spec replaces R1-06's earlier MQTT proposal (R1-06 §9 `MQTT Activity Event Flow`)
- **R1-07** (Instance Registry) — adds `signing_secret`, `signing_kid`, `last_event_received_at` columns
- **R1-08** (Cross-Instance Tenant Portal) — uses `tenant_id` index on `platform_events` for per-tenant cross-instance feed
- **R1-09** (Cross-Instance Observability) — `system.health_degraded` + `instance.started`/`instance.stopped` feed the cross-instance health view
- **R1-13** (Instance Provisioning) — provisions per-instance Pub/Sub publisher service account + signing secret
- **Rezonator S054** (Notification Service) — superadmin port reused for operator alerting on critical events
- **Rezonator S070** (Super Admin Console) — establishes the `designfoundry-superadmin` deployment topology this spec runs inside

---

## 16. Verification & Testing

### Test Cases

| ID | Description | Expected Result | Test Type |
|----|-------------|-----------------|-----------|
| TC1 | Pub/Sub push delivers valid envelope → row in `platform_events` | Row inserted; 200 returned | Integration |
| TC2 | Same envelope `id` delivered twice → exactly one row | 1 row, 2nd POST returns 200 | Integration |
| TC3 | Envelope with bad HMAC signature → 401 | Row not inserted; metric `event_ingest_drop_total{reason="bad_signature"}` incremented | Unit |
| TC4 | Envelope with unknown `instanceId` → 403 | Row not inserted; after 5 retries → DLQ | Integration |
| TC5 | Envelope > 256 KiB → 413 + drop | Logged + acked | Unit |
| TC6 | OIDC token with wrong audience → 401 | Pub/Sub retries up to 5× then DLQs | Integration |
| TC7 | `severity = critical` → operator notification within 60s | Email + Slack + in-app entry created | Integration |
| TC8 | 10 identical errors in 5 min → 1 outbound notification (rest in-app only) | Slack/email rate-limit deduplication works | Integration |
| TC9 | Event aged 91 days → moved to GCS, deleted from DB | Archive row in `platform_event_archives`; `gsutil cat` shows ndjson | Integration |
| TC10 | `severity = critical` event aged 91 days → kept in DB | Row remains in `platform_events` | Integration |
| TC11 | Pull consumer (`PUBSUB_PULL_ENABLED=true`) processes message | Row inserted same as push path | Integration |
| TC12 | Direct mode (`PUBSUB_INGEST_MODE=direct`) accepts envelope with shared secret header | Row inserted | Unit |
| TC13 | Schema version mismatch (`version: "9.9"`) → drop with 200 | Logged, not inserted | Unit |
| TC14 | DLQ inspector lists dead-lettered messages with payload + reason | All DLQ messages visible in UI | E2E |
| TC15 | DLQ replay re-publishes message to main topic | After replay → message processed normally | Integration |
| TC16 | Activity Log (`/superadmin/activity`) shows events written via this pipeline | Cross-instance event from publisher visible in UI | E2E |
| TC17 | `tenant.deleted` event triggers 30-day-delayed purge of that tenant's other events | After 30 days → events for that tenantId gone | Integration |
| TC18 | Per-instance rate limit: 5001st message in 1 min → 429 | Subsequent messages 200 once window resets | Integration |
| TC19 | OpenTelemetry trace context flows from publisher → ingest → DB | Single trace ID spans publish + ingest spans | Integration |
| TC20 | Signing-key rotation: old `signature_kid` still verified during overlap window | Both old and new kid envelopes accepted | Unit |

### Test Data Requirements

- Pub/Sub emulator (`gcloud beta emulators pubsub start`) for local integration tests
- Synthetic envelope generator with all event types from FR-3
- Mock instance registry seeded with one active instance + one deactivated instance + one bogus instanceId for negative tests
- Per-instance HMAC secret fixture
- DLQ pre-seeded with one message of each failure mode for UI tests
