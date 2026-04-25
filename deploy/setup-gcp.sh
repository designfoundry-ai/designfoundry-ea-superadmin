#!/usr/bin/env bash
# GCP resource setup for designfoundry-ea-superadmin
# Run once before first deployment.
# Prerequisites: gcloud CLI authenticated (gcloud auth login),
#                billing account linked to the project.

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-europe-central2}"
ARTIFACT_REPO="${ARTIFACT_REPO:-superadmin}"
CLOUD_RUN_SERVICE="${CLOUD_RUN_SERVICE:-designfoundry-admin}"
SUPERADMIN_SA="designfoundry-superadmin"
GITHUB_DEPLOYER_SA="github-deployer"
WORKLOAD_IDENTITY_POOL="superadmin-pool"
WORKLOAD_IDENTITY_PROVIDER="superadmin-github"

echo "==> Setting up GCP project: ${PROJECT_ID} (region: ${REGION})"
echo "    Service: ${CLOUD_RUN_SERVICE}"

# ── Enable APIs ────────────────────────────────────────────────────────────────
echo "==> Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project="${PROJECT_ID}"

# ── Artifact Registry ────────────────────────────────────────────────────────
echo "==> Creating Artifact Registry repository..."
gcloud artifacts repositories create "${ARTIFACT_REPO}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="DesignFoundry Superadmin Docker images" \
  --project="${PROJECT_ID}" \
  --quiet || echo "    Repository already exists, skipping."

# ── Secret Manager ────────────────────────────────────────────────────────────
echo "==> Creating secrets in Secret Manager..."

create_secret() {
  local name="$1"
  local value="$2"
  echo -n "${value}" | gcloud secrets create "${name}" \
    --data-file=- \
    --project="${PROJECT_ID}" 2>/dev/null || \
  echo -n "${value}" | gcloud secrets versions add "${name}" \
    --data-file=- \
    --project="${PROJECT_ID}"
  echo "    Secret '${name}' created/updated."
}

# Generate a random secret for the admin JWT used by the superadmin app
ADMIN_JWT_SECRET=$(openssl rand -hex 32)
create_secret "superadmin-jwt-secret" "${ADMIN_JWT_SECRET}"

# ── Service Accounts ──────────────────────────────────────────────────────────
echo "==> Creating service accounts..."

create_sa() {
  local sa="$1"
  local display="$2"
  gcloud iam service-accounts create "${sa}" \
    --display-name="${display}" \
    --project="${PROJECT_ID}" 2>/dev/null || echo "    SA '${sa}' already exists."
}

create_sa "${SUPERADMIN_SA}"       "DesignFoundry Superadmin Cloud Run"
create_sa "${GITHUB_DEPLOYER_SA}"  "GitHub Actions Deployer"

SUPERADMIN_SA_EMAIL="${SUPERADMIN_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
GITHUB_DEPLOYER_SA_EMAIL="${GITHUB_DEPLOYER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

grant_role() {
  local sa="$1"
  local role="$2"
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${sa}" \
    --role="${role}" \
    --quiet
}

echo "==> Granting IAM roles to service accounts..."
# Superadmin SA: reads secrets, invokes Cloud Run
grant_role "${SUPERADMIN_SA_EMAIL}"       "roles/secretmanager.secretAccessor"
grant_role "${SUPERADMIN_SA_EMAIL}"       "roles/run.invoker"

# GitHub Deployer SA: full Cloud Run deploy + Artifact Registry write
grant_role "${GITHUB_DEPLOYER_SA_EMAIL}"  "roles/run.admin"
grant_role "${GITHUB_DEPLOYER_SA_EMAIL}" "roles/artifactregistry.writer"
grant_role "${GITHUB_DEPLOYER_SA_EMAIL}" "roles/iam.serviceAccountUser"

# ── Workload Identity Federation (GitHub Actions) ─────────────────────────────
echo "==> Setting up Workload Identity Federation for GitHub Actions..."

# Create or get the workload identity pool
gcloud iam workload-identity-pools create "${WORKLOAD_IDENTITY_POOL}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" \
  --description="GitHub Actions for superadmin repo" \
  2>/dev/null || echo "    Pool already exists, skipping."

POOL_NAME="projects/${PROJECT_ID}/locations/${REGION}/workloadIdentityPools/${WORKLOAD_IDENTITY_POOL}"

# Create the identity provider
gcloud iam workload-identity-pools providers create-github "${WORKLOAD_IDENTITY_PROVIDER}" \
  --location="${REGION}" \
  --workload-identity-pool="${WORKLOAD_IDENTITY_POOL}" \
  --project="${PROJECT_ID}" \
  --attribute-mapping="google.subject=assertion.sub,actor=assertion.actor,repository=assertion.repository" \
  --attribute-condition="repository=='designfoundry-ai/designfoundry-ea-superadmin'" \
  2>/dev/null || echo "    Provider already exists, skipping."

PROVIDER_NAME="${POOL_NAME}/providers/${WORKLOAD_IDENTITY_PROVIDER}"

# Allow the GitHub repo's workflow to impersonate the GitHub Deployer SA
# We use the "principal" format: project-number@ Clouds-project.svc.id.goog
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')

echo "==> Binding Workload Identity Provider to GitHub Deployer SA..."
gcloud iam service-accounts add-iam-policy-binding "${GITHUB_DEPLOYER_SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://${POOL_NAME}/repository/designfoundry-ai/designfoundry-ea-superadmin" \
  --quiet 2>/dev/null || echo "    Binding already exists or is managed separately."

# Print the full Workload Identity Provider resource name for the GitHub env variable
WI_PROVIDER_FULL="projects/${PROJECT_NUMBER}/locations/${REGION}/workloadIdentityPools/${WORKLOAD_IDENTITY_POOL}/providers/${WORKLOAD_IDENTITY_PROVIDER}"
echo "    Workload Identity Provider resource name:"
echo "    ${WI_PROVIDER_FULL}"

# ── Allow unauthenticated for superadmin (admin tool — single org) ───────────────
# The superadmin app is internal-only. For R1, it uses auth cookies, not IAM auth.
# We keep it allow-unauthenticated at the load balancer level and rely on the
# app's own auth (cookie-based NextAuth) for access control.
# If you want to restrict to @designfoundry.ai only, add Cloud Armor rules.

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  GCP Setup Complete — Superadmin"
echo "============================================================"
echo ""
echo "  Project:                    ${PROJECT_ID}"
echo "  Region:                     ${REGION}"
echo "  Artifact Registry repo:     ${ARTIFACT_REPO}"
echo "  Artifact Registry URL:     ${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}"
echo "  Cloud Run service:         ${CLOUD_RUN_SERVICE}"
echo "  Superadmin SA:             ${SUPERADMIN_SA_EMAIL}"
echo "  GitHub Deployer SA:        ${GITHUB_DEPLOYER_SA_EMAIL}"
echo ""
echo "  Next steps:"
echo "  1. Add GitHub Environment variables (see deploy/README.md)"
echo "     - GCP_PROJECT_ID         = ${PROJECT_ID}"
echo "     - GCP_REGION             = ${REGION}"
echo "     - ARTIFACT_REGISTRY_REPO = ${ARTIFACT_REPO}"
echo "     - CLOUD_RUN_SERVICE      = ${CLOUD_RUN_SERVICE}"
echo "     - NEXT_PUBLIC_API_URL    = <your platform API URL>"
echo "     - GCP_WORKLOAD_IDENTITY_PROVIDER = ${WI_PROVIDER_FULL}"
echo "     - GCP_DEPLOYER_SERVICE_ACCOUNT   = ${GITHUB_DEPLOYER_SA_EMAIL}"
echo "     - GCP_SUPERADMIN_SERVICE_ACCOUNT = ${SUPERADMIN_SA_EMAIL}"
echo ""
echo "  2. For first deploy, run:"
echo "     gh workflow run deploy-staging.yml --ref=main"
echo ""
echo "============================================================"
echo "  IMPORTANT: Save the JWT secret below! You won't see it again."
echo "  superadmin-jwt-secret = ${ADMIN_JWT_SECRET}"
echo "  (Use: gcloud secrets versions list superadmin-jwt-secret --project=${PROJECT_ID})"
echo "============================================================"
