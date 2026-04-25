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

Run once per GCP project:

```bash
export GCP_PROJECT_ID=designfoundry-superadmin-staging   # or -production
export GCP_REGION=europe-central2
gcloud config set project $GCP_PROJECT_ID

# Make sure billing is enabled on the project
# Then run:
GCP_PROJECT_ID=$GCP_PROJECT_ID GCP_REGION=$GCP_REGION bash deploy/setup-gcp.sh
```

This script:
- Enables required APIs (Cloud Run, Artifact Registry, Secret Manager, IAM)
- Creates an Artifact Registry Docker repository (`superadmin`)
- Creates a `designfoundry-superadmin` Cloud Run service account
- Creates a `github-deployer` GitHub Actions deployer service account
- Sets up **Workload Identity Federation** (WIF) so GitHub Actions can deploy **without storing service account keys**
- Generates and stores a JWT secret in Secret Manager

**Save the JWT secret** printed at the end of the script — you'll need it as a GitHub Secret.

---

## 2. GitHub Environments

Create two GitHub Environments in the repo (`Settings → Environments`):

### `staging`
Required variables:

| Variable | Value |
|----------|-------|
| `GCP_PROJECT_ID` | `designfoundry-superadmin-staging` |
| `GCP_REGION` | `europe-central2` |
| `ARTIFACT_REGISTRY_REPO` | `superadmin` |
| `CLOUD_RUN_SERVICE` | `designfoundry-ea-superadmin-staging` |
| `SUPERADMIN_SERVICE_ACCOUNT` | `designfoundry-superadmin@designfoundry-superadmin-staging.iam.gserviceaccount.com` |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | `github-deployer@designfoundry-superadmin-staging.iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Output from `setup-gcp.sh` (full resource name) |
| `STAGING_NEXT_PUBLIC_API_URL` | `https://<your-staging-platform-url>/api/v1` |

Required secrets:

| Secret | Value |
|--------|-------|
| `JWT_SECRET` | Value of `superadmin-jwt-secret` from Secret Manager (run `gcloud secrets versions list superadmin-jwt-secret --project=designfoundry-superadmin-staging` to retrieve) |

### `production`
Same as `staging` with:
- `GCP_PROJECT_ID` = `designfoundry-superadmin-production`
- `CLOUD_RUN_SERVICE` = `designfoundry-ea-superadmin`
- `SUPERADMIN_SERVICE_ACCOUNT` = `designfoundry-superadmin@designfoundry-superadmin-production.iam.gserviceaccount.com`
- `GCP_DEPLOYER_SERVICE_ACCOUNT` = `github-deployer@designfoundry-superadmin-production.iam.gserviceaccount.com`
- `STAGING_NEXT_PUBLIC_API_URL` → `PRODUCTION_NEXT_PUBLIC_API_URL`

---

## 3. Deploy Flow

```
develop branch push
  └── deploy-staging.yml
        ├── package job: docker build → .tar artifact
        └── deploy job: download artifact → deploy-gcp action → Cloud Run

main branch push
  └── deploy-production.yml
        ├── build job: docker build + push to Artifact Registry
        └── deploy job: gcloud run deploy
```

---

## 4. Workflow Files

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Lint + typecheck + build (every push) |
| `.github/workflows/deploy-staging.yml` | Deploy to staging on `develop` push + manual trigger |
| `.github/workflows/deploy-production.yml` | Deploy to production on `main` push |
| `.github/actions/deploy-gcp/action.yml` | Reusable deployment adapter (auth → Docker → Cloud Run) |
| `deploy/setup-gcp.sh` | One-time GCP project provisioning |

---

## 5. Smoke Testing

After a staging deploy, the service should respond at:

```
GET https://<cloud-run-url>/
```

Authentication is cookie-based (NextAuth). Login at `/login` with superadmin credentials.

---

## 6. Key Decisions

| Decision | Rationale |
|----------|-----------|
| Single service (no backend split) | Superadmin is an API client + frontend only |
| Workload Identity Federation | No service account key files in GitHub; OIDC-based auth |
| JWT secret in Secret Manager | Private key never in env vars or source code |
| Superadmin SA has `run.invoker` | Service account used by Cloud Run at runtime |
| GitHub Deployer SA has `run.admin` | Can deploy + manage Cloud Run services |
| `allow-unauthenticated` on Cloud Run | Superadmin is internal-only; access controlled by NextAuth cookie |
