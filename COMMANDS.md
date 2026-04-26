# Superadmin Commands Reference

Quick reference for common tasks. Run from the `designfoundry-ea-superadmin` repo root.

---

## GCP Cost Control (from your Mac mini)

```bash
# Check staging / production status
./scripts/gcp-cost-control.sh staging --status
./scripts/gcp-cost-control.sh production --status
./scripts/gcp-cost-control.sh all --status

# Stop staging (scale Cloud Run to 0, costs ~$0)
./scripts/gcp-cost-control.sh staging --stop

# Start staging back up
./scripts/gcp-cost-control.sh staging --start

# Stop/start production
./scripts/gcp-cost-control.sh production --stop
./scripts/gcp-cost-control.sh production --start
```

**Prerequisites:**
```bash
gcloud auth login
gcloud config set project <your-project>
```

---

## GitHub Actions Deploy

```bash
# Deploy staging manually (after pushing to develop)
gh workflow run deploy-staging.yml --ref=develop

# Check run status
gh run list --workflow=deploy-staging.yml --limit 1
gh run view <run-id> --log-failed

# Re-run a failed deploy
gh run rerun <run-id> --repo designfoundry-ai/designfoundry-ea-superadmin
```

---

## GCP Setup (one-time per project)

```bash
# Staging
GCP_PROJECT_ID=designfoundry-admin-staging \
GCP_REGION=europe-central2 \
bash deploy/setup-gcp.sh

# Production
GCP_PROJECT_ID=designfoundry-admin-production \
GCP_REGION=europe-central2 \
bash deploy/setup-gcp.sh
```

---

## Local Development

```bash
# Install dependencies
npm install

# Copy env file
cp .env.example .env.local
# Edit .env.local with your values

# Run dev server
npm run dev

# Build for production
npm run build
```

---

## Useful GCP Commands

```bash
# Check Cloud Run service
gcloud run services describe <service> \
  --region=europe-central2 \
  --project=<project-id>

# Get Cloud Run URL
gcloud run services describe <service> \
  --region=europe-central2 \
  --project=<project-id> \
  --format="value(status.url)"

# Check Artifact Registry images
gcloud artifacts docker.list \
  europe-central2-docker.pkg.dev/<project>/superadmin

# Check Secret Manager
gcloud secrets versions list superadmin-jwt-secret \
  --project=<project-id>

# Get WIF provider resource name
gcloud iam workload-identity-pools providers describe superadmin-github \
  --location=europe-central2 \
  --workload-identity-pool=superadmin-prod \
  --project=<project-id> \
  --format="value(name)"
```

---

## Troubleshooting

```bash
# Check why a GitHub Actions run failed
gh run view <run-id> --log-failed | grep -E "ERROR|fail|403" | head -20

# Verify WIF binding
gcloud iam service-accounts get-iam-policy-binding \
  github-deployer@<project>.iam.gserviceaccount.com \
  --project=<project-id>

# Verify Artifact Registry access
gcloud artifacts repositories get-iam-policy-binding superadmin \
  --location=europe-central2 \
  --project=<project-id>

# Check Cloud Run IAM
gcloud run services get-iam-policy <service> \
  --region=europe-central2 \
  --project=<project-id>
```
