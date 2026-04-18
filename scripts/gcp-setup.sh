#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GCP Setup Script — Super Admin Console
# ─────────────────────────────────────────────────────────────────────────────
#
# Usage:
#   ./scripts/gcp-setup.sh [--plan-only]
#
# Prerequisites (one-time):
#   1. gcloud CLI installed: https://cloud.google.com/sdk/docs/install
#   2. Authenticated: gcloud auth login
#   3. Set your project: gcloud config set project YOUR_PROJECT_ID
#   4. Enable billing on the project
#
# What this script does (idempotent):
#   1. Enable required GCP APIs
#   2. Create Artifact Registry repository (if not exists)
#   3. Create service account for Cloud Run deployment
#   4. Grant IAM roles to the service account
#   5. Create placeholder Docker image (bootstrap Cloud Run)
#   6. Deploy initial Cloud Run service
#   7. Print GitHub Actions repository variables

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-europe-central2}"
AR_REPO="${ARTIFACT_REGISTRY_REPO:-designfoundry}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-designfoundry-ea-superadmin}"
SA_NAME="superadmin-deployer"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}"
GITHUB_REPO="designfoundry-ai/designfoundry-ea-superadmin"

# ── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

info()    { echo -e "${GREEN}[INFO]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
die()     { echo -e "${RED}[ERROR]${RESET}  $*" >&2; exit 1; }

# ── Arg parsing ───────────────────────────────────────────────────────────────
PLAN_ONLY=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --plan-only) PLAN_ONLY=true; shift ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ── Checks ──────────────────────────────────────────────────────────────────
[[ -n "$PROJECT_ID" ]] || die "GCP_PROJECT_ID is not set. Run:\n  export GCP_PROJECT_ID=your-project-id"
info "Project: $PROJECT_ID"
info "Region:  $REGION"

gcloud config get-value account &>/dev/null || die "Not authenticated. Run: gcloud auth login"
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
[[ "$CURRENT_PROJECT" == "$PROJECT_ID" ]] || die "Wrong project. Current: $CURRENT_PROJECT. Set with:\n  gcloud config set project $PROJECT_ID"

# ── Plan ──────────────────────────────────────────────────────────────────────
info ""
info "────────────────────────────────────────────"
info " Ready to create the following GCP resources:"
info "────────────────────────────────────────────"
info "  Project:         $PROJECT_ID"
info "  Region:         $REGION"
info "  Artifact Repo:   $AR_REPO"
info "  Service Account: $SA_EMAIL"
info "  Cloud Run:      $SERVICE_NAME (region: $REGION)"
info "  GitHub repo:    $GITHUB_REPO"
info "────────────────────────────────────────────"
info ""

$PLAN_ONLY && info "Plan mode — no changes made." && exit 0

read -p "Continue? (y/N) " -n 1 -r; echo
[[ $REPLY =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }

# ── Enable APIs ─────────────────────────────────────────────────────────────
info ""
info "─── Enabling GCP APIs ───────────────────────────────────────────────"

for api in \
  run \
  artifactregistry \
  iam \
  cloudresourcemanager; do
  info "Enabling $api..."
  gcloud services enable "${api}.googleapis.com" \
    --project="$PROJECT_ID" \
    --quiet 2>/dev/null || warn "  (may already be enabled)"
done

# ── Artifact Registry ────────────────────────────────────────────────────────
info ""
info "─── Artifact Registry ───────────────────────────────────────────────"

if gcloud artifacts repositories describe "$AR_REPO" \
    --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  info "Repository '$AR_REPO' already exists — skipping."
else
  info "Creating repository '$AR_REPO'..."
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT_ID" \
    --description="DesignFoundry Docker images"
fi

# ── Service Account ──────────────────────────────────────────────────────────
info ""
info "─── Service Account ──────────────────────────────────────────────────"

if gcloud iam service-accounts describe "$SA_EMAIL" &>/dev/null; then
  info "Service account '$SA_EMAIL' already exists."
else
  info "Creating service account..."
  gcloud iam service-accounts create "$SA_NAME" \
    --project="$PROJECT_ID" \
    --display-name="Super Admin Deployer"
fi

# ── IAM Roles ────────────────────────────────────────────────────────────────
info ""
info "─── IAM Roles ─────────────────────────────────────────────────────────"

declare -A ROLES=(
  ["roles/run.admin"]="Cloud Run Admin"
  ["roles/iam.serviceAccountUser"]="Service Account User"
  ["roles/artifactregistry.writer"]="Artifact Registry Writer"
)

for role in "${!ROLES[@]}"; do
  info "Binding $role (${ROLES[$role]})..."
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$role" \
    --quiet 2>/dev/null || warn "  (may already be bound)"
done

# ── GitHub OIDC ─────────────────────────────────────────────────────────────
info ""
info "─── GitHub OIDC Workload Identity ─────────────────────────────────────"

# Discover existing Workload Identity Provider for the repo (if already set up)
WIP=$(gcloud iam workload-identity-pools providers list \
  --workload-identity-pool=github-actions \
  --location=global \
  --project="$PROJECT_ID" \
  --format="value(name)" 2>/dev/null | head -1 || true)

if [[ -z "$WIP" ]]; then
  info "No GitHub Workload Identity Pool found."
  info "Create one in the GCP Console → IAM → Workload Identity Federation:"
  info "  Pool ID:     github-actions"
  info "  Provider:    github-designfoundry"
  info "  Issuer:      https://token.actions.githubusercontent.com"
  info "  Repo:        designfoundry-ai/*"
  warn "  Run this script again after creating the pool."
else
  info "Workload Identity Provider: $WIP"
fi

# ── Bootstrap Docker Image ──────────────────────────────────────────────────
info ""
info "─── Bootstrap Docker Image ───────────────────────────────────────────"

info "Authenticating to Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

info "Pulling a minimal base image to bootstrap..."
docker pull alpine:latest &>/dev/null || true

info "Tagging for Artifact Registry..."
docker tag alpine:latest "${IMAGE}:bootstrap" || true

info "Pushing placeholder image..."
docker push "${IMAGE}:bootstrap" || warn "Push failed — will retry on first CI run"

# ── Initial Cloud Run Deploy ────────────────────────────────────────────────
info ""
info "─── Initial Cloud Run Deploy ─────────────────────────────────────────"

info "Deploying placeholder service..."
gcloud run deploy "$SERVICE_NAME" \
  --image="${IMAGE}:bootstrap" \
  --region="$REGION" \
  --platform=managed \
  --service-account="$SA_EMAIL" \
  --set-env-vars="NODE_ENV=production,NEXT_PUBLIC_API_URL=https://api.designfoundry.ai/api/v1" \
  --min-instances=0 \
  --max-instances=2 \
  --memory=512Mi \
  --cpu=1 \
  --port=3000 \
  --allow-unauthenticated \
  --quiet 2>/dev/null || warn "Deploy failed — will succeed on first CI run"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" \
  --format="value(status.url)" 2>/dev/null || echo "")

# ── GitHub Variables ─────────────────────────────────────────────────────────
info ""
info "─── GitHub Actions Variables ──────────────────────────────────────────"
info ""
info "Add these to: https://github.com/$GITHUB_REPO/settings/variables/actions"
info ""
cat << 'EOF'
  Variable name                    │ Value
  ────────────────────────────────┼────────────────────────────────────────────────
  GCP_PROJECT_ID                  │ {YOUR_GCP_PROJECT_ID}
  GCP_REGION                     │ {YOUR_GCP_REGION}
  ARTIFACT_REGISTRY_REPO         │ {designfoundry}
  CLOUD_RUN_SERVICE              │ {designfoundry-ea-superadmin}
  NEXT_PUBLIC_API_URL            │ https://api.designfoundry.ai/api/v1
EOF

if [[ -n "$WIP" ]]; then
  WIP_ID=$(echo "$WIP" | rev | cut -d/ -f1 | rev)
  POOL_ID=$(echo "$WIP" | rev | cut -d/ -f3 | rev)
  cat << EOF

  Variable name                    │ Value
  ────────────────────────────────┼────────────────────────────────────────────────
  GCP_WORKLOAD_IDENTITY_PROVIDER  │ $WIP
  GCP_DEPLOYER_SERVICE_ACCOUNT    │ $SA_EMAIL
  GCP_FRONTEND_SERVICE_ACCOUNT    │ $SA_EMAIL
EOF
else
  cat << 'EOF'

  Variable name                    │ Value
  ────────────────────────────────┼────────────────────────────────────────────────
  GCP_WORKLOAD_IDENTITY_PROVIDER  │ (create Workload Identity Pool first)
  GCP_DEPLOYER_SERVICE_ACCOUNT    │ $SA_EMAIL
  GCP_FRONTEND_SERVICE_ACCOUNT    │ $SA_EMAIL
EOF
fi

info ""
info "─────────────────────────────────────────────────────────────────────"
if [[ -n "$SERVICE_URL" ]]; then
  info "Deployed! Service URL: $SERVICE_URL"
  info "Point your DNS (admin.designfoundry.ai) to this URL."
else
  warn "Cloud Run service not accessible yet — will resolve on first CI push."
fi
info "─────────────────────────────────────────────────────────────────────"
