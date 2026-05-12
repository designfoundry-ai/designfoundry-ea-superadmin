# DesignFoundry Super Admin Console

Platform operations hub for DesignFoundry SaaS — tenant management, billing, licensing, system health, and platform-wide activity.

**Spec:** `SPECS/S070-super-admin-console.md`

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│              Super Admin Console (Next.js 15)                     │
│                                                                      │
│  /superadmin/*  ───────────────────────────────────────────────►│
│                    calls main platform API (read-only ops)            │
│                                                                      │
│  main branch ──► GitHub Actions ──► Docker ──► Cloud Run          │
│                                   Build+Push      Deploy              │
└──────────────────────────────────────────────────────────────────────┘
```

**Single environment: production only.** No staging. Main branch = production.

---

## Tech Stack

- **Next.js 15** — App Router, React 19, TypeScript
- **TailwindCSS** — Utility-first styling
- **Recharts** — Dashboard charts
- **Lucide React** — Icons

---

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

---

## Environment Variables

```env
# Production / staging only — points the frontend at the rezonator backend.
# For local dev leave empty so the app uses the local /api/superadmin/*
# fallback routes (which accept dev creds super@designfoundry.app /
# superadmin123). Setting a production URL locally breaks login.
NEXT_PUBLIC_API_URL=
NODE_ENV=development
```

---

## Project Structure

```
src/
├── app/
│   ├── login/page.tsx                  # Super admin login
│   └── superadmin/
│       ├── layout.tsx                   # Auth guard + sidebar
│       ├── page.tsx                    # Overview dashboard
│       ├── tenants/                    # Tenant management
│       ├── billing/                     # Billing & Stripe
│       ├── licenses/                   # On-prem license management
│       ├── users/                      # Cross-tenant users
│       ├── activity/                  # Platform activity log
│       ├── system/                     # System health
│       ├── support/                   # Support queue
│       ├── settings/                  # Platform settings
│       └── audit/                     # Admin audit log
├── components/
│   ├── layout/sidebar.tsx
│   └── ui/
└── lib/
    └── api.ts                          # Typed API client
```

---

## Authentication

Login with a `role: superadmin` JWT from the main platform. Token stored in localStorage, validated on every `/superadmin/*` route.

---

## Production Deployment

### 1. One-time GCP Setup

```bash
# Set your project ID + scope, then run the provisioner
GCP_PROJECT_ID=designfoundry-admin-staging \
GCP_REGION=europe-central2 \
RESOURCE_SCOPE=staging \
bash deploy/setup-gcp.sh
```

The script:
- Enables GCP APIs (Cloud Run, Artifact Registry, IAM, Cloud SQL, Pub/Sub, Secret Manager)
- Creates the Artifact Registry Docker repository
- Provisions Cloud SQL (Postgres 15) and waits for it to be RUNNABLE
- Creates `designfoundry-superadmin` (runtime SA) + `github-deployer` (CI SA) with least-privilege roles
- Configures Workload Identity Federation (pool + provider at `locations/global`)
- Generates the RSA-2048 license-signing keypair and stores the public key in Secret Manager
- Creates Pub/Sub topics; defers the push subscription until Cloud Run is deployed
- Prints the GitHub Environment variables/secrets to wire up

Then create the matching GitHub Environments:

```bash
GITHUB_ORG=designfoundry-ai \
REPO=designfoundry-ea-superadmin \
WI_PROVIDER_STAGING="projects/.../locations/global/workloadIdentityPools/.../providers/..." \
WI_PROVIDER_PRODUCTION="projects/.../locations/global/workloadIdentityPools/.../providers/..." \
JWT_SECRET_STAGING="..." \
JWT_SECRET_PRODUCTION="..." \
./deploy/setup-github-environments.sh
```

### 2. GitHub Environment Variables

Set per environment at `https://github.com/designfoundry-ai/designfoundry-ea-superadmin/settings/environments` (the script above does this for you):

| Variable | Staging | Production |
|---|---|---|
| `GCP_PROJECT_ID` | `designfoundry-admin-staging` | `designfoundry-admin-production` |
| `GCP_REGION` | `europe-central2` | `europe-central2` |
| `ARTIFACT_REGISTRY_REPO` | `superadmin` | `superadmin` |
| `CLOUD_RUN_SERVICE` | `designfoundry-ea-superadmin-staging` | `designfoundry-ea-superadmin` |
| `NEXT_PUBLIC_API_URL` | `https://staging.your-platform-domain/api/v1` | `https://your-platform-domain/api/v1` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | (from `setup-gcp.sh` output) | (from `setup-gcp.sh` output) |
| `SUPERADMIN_SERVICE_ACCOUNT` | `designfoundry-superadmin@designfoundry-admin-staging.iam.gserviceaccount.com` | `designfoundry-superadmin@designfoundry-admin-production.iam.gserviceaccount.com` |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | `github-deployer@designfoundry-admin-staging.iam.gserviceaccount.com` | `github-deployer@designfoundry-admin-production.iam.gserviceaccount.com` |

### 3. GitHub Actions — Enable

Push to `main` → GitHub Actions automatically:
1. Runs `npm ci && npm run build`
2. Builds and pushes Docker image to Artifact Registry
3. Deploys to Cloud Run

No manual steps required after setup.

### 4. DNS

After first deploy, point `admin.designfoundry.ai` → Cloud Run service URL (shown in GitHub Actions summary).

---

## Sections

| Route | Description |
|---|---|
| `/superadmin` | Overview — MRR, tenants, churn, signups, system status |
| `/superadmin/tenants` | Tenant list, suspend/activate, per-tenant detail |
| `/superadmin/billing` | Stripe revenue, failed payments, refunds |
| `/superadmin/licenses` | On-premises license management |
| `/superadmin/users` | All users across all tenants |
| `/superadmin/activity` | Platform-wide activity log |
| `/superadmin/system` | Service health, errors, deployments |
| `/superadmin/support` | Support ticket queue |
| `/superadmin/settings` | Platform settings, feature flags |
| `/superadmin/audit` | Admin action audit log |

---

## CI/CD

```
push to main
     │
     ▼
┌─────────────────────┐
│  GitHub Actions     │
│  CI: lint + build  │
└────────┬────────────┘
         │ build passes
         ▼
┌─────────────────────┐
│  Deploy to Cloud Run │
│  docker build+push  │
│  gcloud run deploy  │
└─────────────────────┘
```

---

## License

Proprietary — DesignFoundry
