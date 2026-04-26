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
| `scripts/gcp-cost-control.sh` | Start/stop/scale staging or production infra |
| `COMMANDS.md` | Quick command reference (gcloud, gh, local dev) |

## Architecture Decisions

1. **Two-layer auth:** GCP Cloud Run IAM (`allAuthenticatedUsers`) + app JWT email domain check (`@designfoundry.ai`)
2. **Workload Identity Federation:** GitHub Actions authenticates via WIF, no SA key files stored
3. **Staging = zero-cost by default:** Cloud Run scaled to 0, no Cloud SQL provisioned
4. **Production-only for now:** staging deploy is manual (`workflow_dispatch`), not auto on push
5. **Multitenant SAAS security model:** Option B — each instance's SA manages its own Cloud Run

## CI/CD Pipeline

- `main` push → `deploy-production.yml` (auto-deploy to production Cloud Run)
- `develop` push → `ci.yml` (lint + typecheck only, no auto-deploy)
- Staging deploy: GitHub Actions → `workflow_dispatch` (manual trigger only)

## GCP Projects

| Project | Project ID | Purpose |
|---------|------------|---------|
| Staging | `designfoundry-admin-staging` | 598200600909 — currently scaled to 0 |
| Production | `designfoundry-admin-production` | 262048612833 |

## R1 Feature Specs

All feature specs are in `SPECS/R1/`. Key specs for current work:
- **R1-07 (Instance Registry):** Register + manage EA instances
- **R1-14 (Platform Event Bus):** Pub/Sub subscriber + `platform_events` table

## Important Notes

- **Do not auto-deploy on `develop` push** — this is intentional for zero-cost staging
- **Database:** `ADMIN_DATABASE_URL` env var points to Cloud SQL for production. Staging uses in-memory/dev fallback.
- **Pub/Sub:** Not yet provisioned — R1-14 infrastructure (topic, subscription, archival GCS bucket) is pending
- **Cloud SQL:** Not provisioned for staging. Production Cloud SQL is the superadmin's own DB, separate from EA instances.
- **Org policy constraint:** `constraints/iam.allowedPolicyMemberDomains` blocks `allAuthenticatedUsers` — Cloud Run requires Google Workspace auth

## Testing

```bash
npm run lint
npm run typecheck
npm run build
```
