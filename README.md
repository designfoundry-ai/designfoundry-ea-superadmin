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
NEXT_PUBLIC_API_URL=https://api.designfoundry.ai/api/v1   # Main platform API
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
# Set your project ID
export GCP_PROJECT_ID=your-project-id

# Run the setup script
./scripts/gcp-setup.sh
```

The script:
- Enables GCP APIs (Cloud Run, Artifact Registry, IAM)
- Creates the Artifact Registry Docker repository
- Creates a deployment service account with appropriate roles
- Deploys an initial placeholder Cloud Run service
- Prints the GitHub Actions variables to add

### 2. GitHub Actions Variables

Add to `https://github.com/designfoundry-ai/designfoundry-ea-superadmin/settings/variables/actions`:

| Variable | Value |
|---|---|
| `GCP_PROJECT_ID` | Your GCP project ID |
| `GCP_REGION` | `europe-central2` |
| `ARTIFACT_REGISTRY_REPO` | `designfoundry` |
| `CLOUD_RUN_SERVICE` | `designfoundry-ea-superadmin` |
| `NEXT_PUBLIC_API_URL` | `https://api.designfoundry.ai/api/v1` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full provider resource name (after creating Workload Identity Pool) |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | `superadmin-deployer@project.iam.gserviceaccount.com` |
| `GCP_FRONTEND_SERVICE_ACCOUNT` | Same as above |

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
