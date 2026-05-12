# DesignFoundry Superadmin — GCP Deployment Guide

## Architecture

```
Internet → Cloud Run (superadmin frontend :3000)
                ↓
         DesignFoundry Platform API (external, multi-tenant)
```

The Superadmin is a single-service Next.js app deployed to **Cloud Run**. It reads/writes to the shared platform database and integrates with Stripe, GCP Secret Manager, and GCP KMS. It is **not** a write master for tenant data — it acts as an admin client to the platform API.

---

## 1. One-Time GCP Setup

Run once per GCP project. The script is idempotent — safe to re-run after Cloud Run is deployed (it then also creates the Pub/Sub push subscription, which depends on the Cloud Run URL existing).

```bash
# staging
GCP_PROJECT_ID=designfoundry-admin-staging \
GCP_REGION=europe-central2 \
RESOURCE_SCOPE=staging \
bash deploy/setup-gcp.sh

# production
GCP_PROJECT_ID=designfoundry-admin-production \
GCP_REGION=europe-central2 \
RESOURCE_SCOPE=production \
bash deploy/setup-gcp.sh
```

What `deploy/setup-gcp.sh` does:

- Enables required APIs (Cloud Run, Artifact Registry, Secret Manager, IAM, Cloud SQL, Pub/Sub, Cloud Scheduler).
- Creates the Artifact Registry Docker repository (`superadmin`).
- Creates two service accounts:
  - `designfoundry-superadmin` — the Cloud Run runtime SA.
  - `github-deployer` — the GitHub Actions deployer SA.
- Grants least-privilege IAM roles to each (`run.invoker` / `cloudsql.client` / `pubsub.publisher` / `secretmanager.secretAccessor` for runtime; `run.admin` / `artifactregistry.writer` / `iam.serviceAccountUser` for deployer).
- Sets up **Workload Identity Federation** (WIF) so GitHub Actions can deploy **without storing service account keys**. The pool and provider live at `locations/global` (OIDC tokens carry no region). The `principalSet://iam.googleapis.com/projects/{NUMBER}/locations/global/workloadIdentityPools/{POOL}/attribute.repository/{ORG}/{REPO}` member URL pins the binding to this exact repo.
- Provisions Cloud SQL (Postgres 15, `db-custom-1-3840`, private IP) and polls until the instance reaches `RUNNABLE` — up to 10 min, hard-error on `FAILED` or timeout.
- Generates an RSA-2048 license-signing keypair under `./keys/` (private key `chmod 600`) and stores the **public** key in Secret Manager as `superadmin-license-public-key`.
- Creates Pub/Sub topics `platform-events` + `platform-events-dlq`. If Cloud Run isn't deployed yet, the push subscription is deferred with a clear "re-run me later" note — first run won't fail.
- Stores the JWT secret in Secret Manager as `superadmin-jwt-secret`.

**Save the printed JWT secret, RSA private-key path, and WIF provider resource path** — they go into GitHub Environment variables/secrets in the next step.

---

## 2. GitHub Environments

Two GitHub Environments are required (`Settings → Environments`). The bootstrap script `deploy/setup-github-environments.sh` creates them and populates the variables; it uses `gh variable set` for vars and `gh secret set` for secrets (the latter is needed to seal the value with the env's libsodium public key — raw `gh api` cannot).

```bash
GITHUB_ORG=designfoundry-ai \
REPO=designfoundry-ea-superadmin \
WI_PROVIDER_STAGING="projects/.../locations/global/workloadIdentityPools/.../providers/..." \
WI_PROVIDER_PRODUCTION="projects/.../locations/global/workloadIdentityPools/.../providers/..." \
JWT_SECRET_STAGING="..." \
JWT_SECRET_PRODUCTION="..." \
./deploy/setup-github-environments.sh
```

Variables per environment (created by the script above):

| Variable | Staging | Production |
|---|---|---|
| `GCP_PROJECT_ID` | `designfoundry-admin-staging` | `designfoundry-admin-production` |
| `GCP_REGION` | `europe-central2` | `europe-central2` |
| `ARTIFACT_REGISTRY_REPO` | `superadmin` | `superadmin` |
| `CLOUD_RUN_SERVICE` | `designfoundry-ea-superadmin-staging` | `designfoundry-ea-superadmin` |
| `SUPERADMIN_SERVICE_ACCOUNT` | `designfoundry-superadmin@designfoundry-admin-staging.iam.gserviceaccount.com` | `designfoundry-superadmin@designfoundry-admin-production.iam.gserviceaccount.com` |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | `github-deployer@designfoundry-admin-staging.iam.gserviceaccount.com` | `github-deployer@designfoundry-admin-production.iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | (from `setup-gcp.sh` summary) | (from `setup-gcp.sh` summary) |
| `NEXT_PUBLIC_API_URL` | staging platform API base URL | production platform API base URL |

Variables read only by `deploy-production.yml`:

| Variable | Notes |
|---|---|
| `LICENSE_KEY_ID` | RSA key-id stamped into `kid` on every license JWT (e.g. `prod-2026-01`). Set on the production environment only. |
| `JWT_SECRET_NAME` | Optional. Defaults to `superadmin-jwt-secret`; override only if you renamed the Secret Manager secret. |

Secrets per environment:

| Secret | Where used |
|---|---|
| `JWT_SECRET` | NextAuth signing secret. Source: `superadmin-jwt-secret` in Secret Manager (run `gcloud secrets versions access latest --secret=superadmin-jwt-secret --project=<project>` to fetch). |
| `ADMIN_DATABASE_URL` | **Production only.** Cloud SQL connection string for the superadmin's admin DB. Source: `superadmin-database-url` secret created by `setup-gcp.sh`. |
| `RSA_PRIVATE_KEY` | **Production only.** PEM-encoded RSA private key for license signing. Source: `./keys/private.pem` generated by `setup-gcp.sh`. |

> **Note on the `NEXT_PUBLIC_API_URL` rename:** the variable was previously called `STAGING_NEXT_PUBLIC_API_URL`. Since vars now live at the Environment scope (not repo-level), the prefix is redundant. The bootstrap script idempotently deletes the old name when run on an existing environment.

---

## 3. Workflow Architecture

Both `deploy-staging.yml` and `deploy-production.yml` are single-job workflows that delegate the actual deploy to the `./.github/actions/deploy-gcp` composite action. The composite does the heavy lifting (auth → setup-gcloud → buildx → Artifact Registry auth → build & push → Cloud Run deploy → IAM binding → service URL). Both environments share the same code path, which keeps regressions in one path catchable by runs of the other.

```
develop branch push
  └── ci.yml (typecheck + lint + build + jest)

manual workflow_dispatch (or main → push for production)
  └── deploy-{staging|production}.yml
        └── deploy job (environment: <env>)
              ├── Validate required vars (fails fast if NEXT_PUBLIC_API_URL missing)
              ├── Resolve image tag
              ├── ./.github/actions/deploy-gcp ← single source of truth
              │     ├── google-github-actions/auth@v2 (WIF)
              │     ├── google-github-actions/setup-gcloud@v2
              │     ├── docker/setup-buildx-action@v3
              │     ├── gcloud auth configure-docker (Artifact Registry)
              │     ├── docker/build-push-action@v6 (push :tag + :latest)
              │     ├── gcloud run deploy --no-allow-unauthenticated
              │     ├── gcloud run services add-iam-policy-binding
              │     │     --member=domain:designfoundry.ai roles/run.invoker
              │     └── gcloud run services describe → service_url output
              └── Deployment summary
```

### Composite inputs

| Input | Required | Used by | Notes |
|---|---|---|---|
| `environment_name` | yes | both | Display-only label ("staging" / "production") |
| `image_tag` | yes | both | SHA passed from `Resolve image tag` step |
| `gcp_project_id` / `gcp_region` | yes | both | |
| `gcp_workload_identity_provider` | yes | both | Full WIF provider resource path |
| `gcp_deployer_service_account` | yes | both | SA impersonated via WIF |
| `artifact_registry_repo` / `cloud_run_service` | yes | both | |
| `service_account` | yes | both | Cloud Run **runtime** SA (`designfoundry-superadmin`) |
| `next_public_api_url` | yes | both | Baked into the client bundle at build time |
| `jwt_secret_name` | no (default `superadmin-jwt-secret`) | both | Name of the Secret Manager secret bound to `JWT_SECRET` |
| `extra_env_vars` | no (default `""`) | production only | See below |

### `extra_env_vars` — caret-delimited form

Production needs additional env vars on Cloud Run (`ADMIN_DATABASE_URL`, `RSA_PRIVATE_KEY`, `LICENSE_KEY_ID`); staging does not. The composite accepts these via `extra_env_vars` and stitches them onto the base set (`NODE_ENV`, `NEXT_PUBLIC_API_URL`) before passing to `gcloud run deploy --set-env-vars`.

**Format:** caret-delimited (`^^^`), defensive against values that contain commas (multi-host Postgres connection strings, JSON blobs, etc.).

```yaml
extra_env_vars: |
  ^^^^ADMIN_DATABASE_URL=postgresql://user:pass@/db?host=/cloudsql/...^^^RSA_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----
  ...
  -----END PRIVATE KEY-----^^^LICENSE_KEY_ID=prod-2026-01
```

The leading `^^^^` (four carets, then the delimiter `^^^`) is gcloud's syntax for "use `^^^` as the delimiter instead of comma." See `gcloud topic escaping` for the full rules. The composite forwards this verbatim to `--set-env-vars`. Values may contain newlines, equals signs, anything except the `^^^` triple — which is virtually impossible in practice.

---

## 4. Zero-Cost Staging

Staging superadmin is designed to run at **$0 compute cost**:

- Cloud Run: scaled to 0 instances when idle (1+ when started).
- Cloud SQL: provisioned but stoppable via `activation-policy=NEVER` (compute billing pauses; storage continues at low rate).
- No Redis / no Pub/Sub on staging by default.

To control staging infrastructure from your laptop:

```bash
# Show current state of both environments
./scripts/gcp-cost-control.sh staging --status

# Stop staging (Cloud Run min-instances=0, Cloud SQL activation-policy=NEVER)
./scripts/gcp-cost-control.sh staging --stop

# Start staging (Cloud SQL activation-policy=ALWAYS; Cloud Run min-instances kept at 0
#               so cold start, but Cloud SQL is reachable for app boot)
./scripts/gcp-cost-control.sh staging --start
```

When stopped, staging Cloud Run is $0 and Cloud SQL is reduced to storage-only cost (no compute). Cold start on first request is ~5–10s.

---

## 5. Auth Model

**Two-layer auth** (CLAUDE.md and the deploy step both call this out):

1. **Cloud Run IAM.** `--no-allow-unauthenticated` on the service means only principals with `roles/run.invoker` can reach the URL. The composite grants this to `domain:designfoundry.ai` (the broader `allAuthenticatedUsers` is blocked by org policy `constraints/iam.allowedPolicyMemberDomains`).
2. **Application JWT.** `src/app/api/auth/login/route.ts` enforces the `@designfoundry.ai` email domain on top of the IAM gate. Defense in depth.

---

## 6. Workflow Files Map

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Lint + typecheck + build + jest on every push/PR |
| `.github/workflows/deploy-staging.yml` | `workflow_dispatch` only; calls the composite |
| `.github/workflows/deploy-production.yml` | Auto-deploys on push to `main`; calls the composite with `extra_env_vars` |
| `.github/actions/deploy-gcp/action.yml` | Reusable Cloud Run deploy composite (the only place gcloud commands live) |
| `deploy/setup-gcp.sh` | One-time GCP project provisioning (idempotent) |
| `deploy/setup-github-environments.sh` | Creates + populates the GitHub Environments via `gh secret set` / `gh variable set` |
| `scripts/gcp-cost-control.sh` | Start/stop/status Cloud Run + Cloud SQL per environment |

---

## 7. Smoke Testing

After a deploy, the service URL is in the workflow summary. Login:

```
GET https://<cloud-run-url>/login
```

The Cloud Run IAM layer first requires a Workspace-domain credential; the app then enforces `@designfoundry.ai` on the login form (NextAuth-style cookie session after that).

---

## 8. Key Decisions

| Decision | Rationale |
|----------|-----------|
| Single service (no backend split) | Superadmin is API client + frontend only |
| Workload Identity Federation | No service account key files in GitHub; OIDC token exchange |
| Pools at `locations/global` | GitHub OIDC tokens have no region; the action expects global ARNs |
| `principalSet` pinned to `attribute.repository/<org>/<repo>` | Per-repo binding, not pool-wide |
| Two-layer auth (IAM + JWT) | Defense in depth against either layer being misconfigured |
| Composite action drives both envs | One code path; regressions caught by either env's runs |
| `^^^`-delimited `extra_env_vars` | Comma-safe for future multi-host conn strings / JSON values |
| RSA private key as a GitHub Secret (production only) | Kept out of source; loaded into Cloud Run via `--set-env-vars` |
