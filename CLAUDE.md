# CLAUDE.md — DesignFoundry Superadmin

You are helping maintain the DesignFoundry Superadmin application. This file provides project-specific guidance for coding agents (Claude Code, Codex, etc.).

## Project Overview

**DesignFoundry Superadmin** (`designfoundry-ai/designfoundry-ea-superadmin`) is a Next.js 15 admin console for managing the DesignFoundry multi-tenant SaaS platform. It is deployed to Google Cloud Run.

- **Frontend:** Next.js 15 + React 19 + TailwindCSS + Radix UI
- **Backend:** Next.js API routes (serverless)
- **Auth:** NextAuth.js with Google Workspace (JWT, restricted to `@designfoundry.ai` domain)
- **Database:** PostgreSQL via `pg` Pool (`ADMIN_DATABASE_URL`)
- **Features:** Tenant management, billing, licensing, instance registry, observability, AI models registry (R1 spec)

## Key Files

| Path | Purpose |
|------|---------|
| `src/app/api/auth/login/route.ts` | Login — enforces `@designfoundry.ai` domain |
| `src/lib/admin-db.ts` | PostgreSQL connection pool |
| `src/lib/admin-db-init.ts` | Schema init (instances, platform_events, admin_audit_log, super_admins tables) |
| `SPECS/R1/R1-14-platform-event-bus.md` | Pub/Sub event ingestion spec |
| `SPECS/SUMMARY.md` | All R1 feature specs |
| `deploy/setup-gcp.sh` | One-time GCP provisioning script |
| `scripts/gcp-cost-control.sh` | Start/stop/status the production Cloud Run + Cloud SQL |
| `COMMANDS.md` | Quick command reference (gcloud, gh, local dev) |

## Architecture Decisions

1. **Two-layer auth:** GCP Cloud Run IAM (`domain:designfoundry.ai` → `roles/run.invoker`, granted by the deploy step) + app JWT email-domain check (`@designfoundry.ai` enforced in `src/app/api/auth/login/route.ts`). `allAuthenticatedUsers` is blocked by the `constraints/iam.allowedPolicyMemberDomains` org policy.
2. **Workload Identity Federation:** GitHub Actions authenticates via WIF, no SA key files stored.
3. **Production-only deployment:** Admin has a single GCP project, a single Cloud Run service, and a single GitHub Environment. There is no staging deploy, no staging project, no `workflow_dispatch`-only branch. Code is reviewed on `develop` via CI; production ships on push to `main`.
4. **Multitenant SAAS security model:** Option B — each instance's SA manages its own Cloud Run.

## CI/CD Pipeline

- `develop` push → `ci.yml` (lint + typecheck + build + jest; no deploy)
- `main` push → `deploy-production.yml` (auto-deploy to production Cloud Run via the `./.github/actions/deploy-gcp` composite)

## GCP Projects

| Project | Project ID | Purpose |
|---------|------------|---------|
| Production | `designfoundry-admin-production` | 262048612833 |

## R1 Feature Specs

All feature specs are in `SPECS/R1/`. Key specs for current work:
- **R1-07 (Instance Registry):** Register + manage EA instances
- **R1-14 (Platform Event Bus):** Pub/Sub subscriber + `platform_events` table

## Event Bus

Cross-app event delivery to rezonator instances. Two driver modes; selected by `EVENT_BUS_MODE`:

| Mode | Use case |
|---|---|
| `direct` (default) | HTTP POST to `${instance.url}/api/v1/platform/events` with HMAC-signed envelope + `X-Ingest-Secret` header. Simplest dev shape. |
| `pubsub` | Publish to a GCP Pub/Sub topic (or local emulator). Production cross-app path. Topic name: `EVENT_BUS_TOPIC` (default `platform-events`). Uses `PUBSUB_EMULATOR_HOST` automatically when set. |
| `disabled` | No-op publisher. |

Receiver: `POST /api/events/ingest` accepts BOTH shapes:
- Direct: flat envelope JSON in body.
- Pub/Sub push: `{ message: { data: <base64-envelope>, attributes, messageId }, subscription }` — handler unwraps via `looksLikePubSubPush()` adapter, then passes to the same `validateEnvelope` path.

Auth: per-instance HMAC. The handler looks up `envelope.instanceId` in `instances`, decrypts the active + pending API keys via `instance-crypto.ts`, and verifies the envelope signature against whichever matches. No shared global secret.

Local emulator workflow (run from `/Users/lukas/Git/rezonator`):

```bash
./scripts/setup-local-pubsub.sh start    # emulator + topic + push subscription
# Run rezonator with EVENT_BUS_DRIVER=pubsub (see rezonator CLAUDE.md).
# Run this superadmin app with `npm run dev` on port 3002. Push subscription
# routes to host.docker.internal:3002/api/events/ingest by default.
```

`@google-cloud/pubsub` is a runtime dependency (installed via the same commit that activated this path).

## Important Notes

- **Do not auto-deploy on `develop` push** — `develop` is the integration branch, gated by `ci.yml`. Promote to production by merging `develop` → `main`.
- **Database:** `ADMIN_DATABASE_URL` env var points to Cloud SQL for the production superadmin. Local dev uses the `postgresql://design_foundry:design_foundry@localhost:5432/designfoundry_admin` fallback in `lib/admin-db.ts`.
- **Pub/Sub:** Topics + DLQ provisioned by `deploy/setup-gcp.sh`. The push subscription is deferred until the first Cloud Run deploy exists; re-run the script to materialize it.
- **Cloud SQL:** Production Cloud SQL is the superadmin's own admin DB, separate from the EA platform DB and from individual EA-instance DBs.
- **Org policy constraint:** `constraints/iam.allowedPolicyMemberDomains` blocks `allAuthenticatedUsers` — Cloud Run requires Google Workspace auth via `domain:designfoundry.ai` bindings instead.

## Testing

```bash
npm run lint
npm run typecheck
npm run build
```
