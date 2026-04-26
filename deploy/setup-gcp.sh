#!/usr/bin/env bash
# GCP resource setup for designfoundry-ea-superadmin
# Run once per GCP project, or once for both via RESOURCE_SCOPE=both
#
# Usage:
#   GCP_PROJECT_ID=designfoundry-admin-production \
#   GCP_REGION=europe-central2 \
#   RESOURCE_SCOPE=production \
#   bash deploy/setup-gcp.sh
#
# RESOURCE_SCOPE: staging | production | both (default: production)

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*"; }
success() { echo -e "${GREEN}[OK]${RESET}   $*"; }

section() { echo ""; echo -e "${BOLD}${CYAN}═══ $1 ═══${RESET}"; }

# ── Config ───────────────────────────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-europe-central2}"
SCOPE="${RESOURCE_SCOPE:-production}"

ARTIFACT_REPO="${ARTIFACT_REPO:-superadmin}"
CLOUD_RUN_SERVICE="${CLOUD_RUN_SERVICE:-designfoundry-admin}"
SUPERADMIN_SA="designfoundry-superadmin"
GITHUB_DEPLOYER_SA="github-deployer"
WORKLOAD_IDENTITY_POOL="superadmin-pool"
WORKLOAD_IDENTITY_PROVIDER="superadmin-github"
CLOUD_SQL_INSTANCE="superadmin-${SCOPE}"
LICENCE_KEY_ID="prod-2026-01"
KEYS_DIR="keys"

# ── Validate gcloud ───────────────────────────────────────────────────────────
check_gcloud() {
  if ! command -v gcloud &>/dev/null; then
    error "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"
    exit 1
  fi
  ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -n1)
  if [[ -z "${ACTIVE_ACCOUNT}" ]]; then
    error "No active gcloud account. Run: gcloud auth login"
    exit 1
  fi
  info "Using account: ${ACTIVE_ACCOUNT}"
  info "Target project: ${PROJECT_ID}"
  info "Scope: ${SCOPE}"
}

# ── Enable APIs ────────────────────────────────────────────────────────────────
enable_apis() {
  section "Enabling APIs"
  gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    iam.googleapis.com \
    cloudresourcemanager.googleapis.com \
    sqladmin.googleapis.com \
    pubsub.googleapis.com \
    cloudscheduler.googleapis.com \
    --project="${PROJECT_ID}" 2>&1 | grep -v "already enabled" || true
  success "APIs enabled"
}

# ── Artifact Registry ────────────────────────────────────────────────────────
create_artifact_registry() {
  section "Creating Artifact Registry"
  gcloud artifacts repositories create "${ARTIFACT_REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="DesignFoundry Superadmin Docker images" \
    --project="${PROJECT_ID}" \
    --quiet 2>/dev/null || info "Repository already exists, skipping."
  success "Artifact Registry ready"
}

# ── Secret Manager helpers ───────────────────────────────────────────────────────
create_secret() {
  local name="$1"
  local value="$2"
  echo -n "${value}" | gcloud secrets create "${name}" \
    --data-file=- \
    --project="${PROJECT_ID}" 2>/dev/null || \
  echo -n "${value}" | gcloud secrets versions add "${name}" \
    --data-file=- \
    --project="${PROJECT_ID}" >/dev/null
  info "Secret '${name}' created/updated"
}

create_secret_from_file() {
  local name="$1"
  local file="$2"
  gcloud secrets create "${name}" \
    --data-file="${file}" \
    --project="${PROJECT_ID}" 2>/dev/null || \
  gcloud secrets versions add "${name}" \
    --data-file="${file}" \
    --project="${PROJECT_ID}" >/dev/null
  info "Secret '${name}' created from file"
}

add_secret_version() {
  local name="$1"
  local value="$2"
  echo -n "${value}" | gcloud secrets versions add "${name}" \
    --data-file=- \
    --project="${PROJECT_ID}" 2>/dev/null
  info "Secret '${name}' updated with new version"
}

# ── RSA Key Pair for License Signing ─────────────────────────────────────────
generate_license_keys() {
  section "Generating RSA License Keys"

  mkdir -p "${KEYS_DIR}"

  if [[ -f "${KEYS_DIR}/private.pem" && -f "${KEYS_DIR}/public.pem" ]]; then
    warn "License keys already exist in ./${KEYS_DIR}/ — skipping generation"
    return
  fi

  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "${KEYS_DIR}/private.pem" 2>/dev/null
  openssl rsa -pubout -in "${KEYS_DIR}/private.pem" -out "${KEYS_DIR}/public.pem" 2>/dev/null

  chmod 600 "${KEYS_DIR}/private.pem"
  info "Generated RSA-2048 key pair in ./${KEYS_DIR}/"
  success "Private key: ${KEYS_DIR}/private.pem (keep this file safe!)"
}

# ── Cloud SQL ──────────────────────────────────────────────────────────────────
create_cloudsql() {
  section "Creating Cloud SQL Instance"

  local existing
  existing=$(gcloud sql instances describe "${CLOUD_SQL_INSTANCE}" \
    --project="${PROJECT_ID}" 2>/dev/null || echo "")

  if [[ -n "${existing}" ]]; then
    info "Cloud SQL instance '${CLOUD_SQL_INSTANCE}' already exists — skipping"
  else
    gcloud sql instances create "${CLOUD_SQL_INSTANCE}" \
      --database-version=POSTGRES_15 \
      --tier=db-custom-1-3840 \
      --region="${REGION}" \
      --storage-type=SSD \
      --storage-size=10 \
      --storage-auto-increase \
      --backup-start-time=03:00 \
      --network=default \
      --no-assign-ip \
      --project="${PROJECT_ID}" \
      --quiet 2>&1 | grep -v "already exists" || true

    # Wait for instance to be ready
    info "Waiting for Cloud SQL instance to be ready..."
    gcloud sql instances describe "${CLOUD_SQL_INSTANCE}" \
      --project="${PROJECT_ID}" \
      --format="value(state)" 2>/dev/null | grep -q RUNNING || \
      sleep 30
  fi

  # Create database
  gcloud sql databases create "designfoundry_admin" \
    --instance="${CLOUD_SQL_INSTANCE}" \
    --project="${PROJECT_ID}" \
    --quiet 2>/dev/null || info "Database already exists"

  # Create superadmin user
  local DB_PASS
  DB_PASS=$(openssl rand -hex 16)
  gcloud sql users set-password postgres \
    --instance="${CLOUD_SQL_INSTANCE}" \
    --password="${DB_PASS}" \
    --project="${PROJECT_ID}" \
    --quiet 2>/dev/null || true

  info "Cloud SQL instance: ${CLOUD_SQL_INSTANCE}"
  info "Database: designfoundry_admin"
  info "User: postgres"
  info "Password: ${DB_PASS} (save this!)"

  # Store connection string as secret
  local CONN_STRING="postgresql://postgres:${DB_PASS}@/${CLOUD_SQL_INSTANCE}?host=/cloudsql/${PROJECT_ID}:${REGION}:${CLOUD_SQL_INSTANCE}"
  create_secret "superadmin-database-url" "${CONN_STRING}"

  success "Cloud SQL ready"
}

# ── Pub/Sub ─────────────────────────────────────────────────────────────────────
create_pubsub() {
  section "Creating Pub/Sub Topic"

  local TOPIC="platform-events"

  gcloud pubsub topics create "${TOPIC}" \
    --project="${PROJECT_ID}" 2>/dev/null || info "Topic '${TOPIC}' already exists"

  # Dead-letter topic
  gcloud pubsub topics create "${TOPIC}-dlq" \
    --project="${PROJECT_ID}" 2>/dev/null || info "DLQ topic already exists"

  # Push subscription to superadmin ingest endpoint
  # Note: the subscription is created but Cloud Run URL must be known
  local SUBSCRIPTION="superadmin-events-ingest"
  local PUSH_ENDPOINT="https://$(gcloud run services describe "${CLOUD_RUN_SERVICE}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format="value(status.url)" 2>/dev/null | sed 's|https://||')/api/v1/superadmin/events/ingest"

  gcloud pubsub subscriptions create "${SUBSCRIPTION}" \
    --topic="${TOPIC}" \
    --project="${PROJECT_ID}" \
    --push-auth-service-account="${SUPERADMIN_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --push-endpoint="${PUSH_ENDPOINT}" \
    --ack-deadline=30 \
    --message-retention-duration=604800 \
    --max-delivery-attempts=5 \
    --dead-letter-topic="projects/${PROJECT_ID}/topics/${TOPIC}-dlq" \
    2>/dev/null || info "Subscription '${SUBSCRIPTION}' already exists (or Cloud Run not ready yet)"

  success "Pub/Sub topic '${TOPIC}' ready"
}

# ── Service Accounts ──────────────────────────────────────────────────────────
create_service_accounts() {
  section "Creating Service Accounts"

  create_sa() {
    local sa="$1"
    local display="$2"
    gcloud iam service-accounts create "${sa}" \
      --display-name="${display}" \
      --project="${PROJECT_ID}" 2>/dev/null || info "SA '${sa}' already exists"
  }

  create_sa "${SUPERADMIN_SA}"       "DesignFoundry Superadmin Cloud Run"
  create_sa "${GITHUB_DEPLOYER_SA}"  "GitHub Actions Deployer"

  SUPERADMIN_SA_EMAIL="${SUPERADMIN_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
  GITHUB_DEPLOYER_SA_EMAIL="${GITHUB_DEPLOYER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
}

grant_role() {
  local sa="$1"
  local role="$2"
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${sa}" \
    --role="${role}" \
    --quiet 2>/dev/null || true
}

grant_sa_roles() {
  section "Granting IAM Roles"

  # Superadmin SA
  grant_role "${SUPERADMIN_SA_EMAIL}" "roles/secretmanager.secretAccessor"
  grant_role "${SUPERADMIN_SA_EMAIL}" "roles/run.invoker"
  grant_role "${SUPERADMIN_SA_EMAIL}" "roles/cloudsql.client"
  grant_role "${SUPERADMIN_SA_EMAIL}" "roles/pubsub.publisher"

  # GitHub Deployer SA
  grant_role "${GITHUB_DEPLOYER_SA_EMAIL}" "roles/run.admin"
  grant_role "${GITHUB_DEPLOYER_SA_EMAIL}" "roles/artifactregistry.writer"
  grant_role "${GITHUB_DEPLOYER_SA_EMAIL}" "roles/iam.serviceAccountUser"

  success "IAM roles granted"
}

# ── Workload Identity Federation ───────────────────────────────────────────────
setup_wif() {
  section "Setting up Workload Identity Federation"

  gcloud iam workload-identity-pools create "${WORKLOAD_IDENTITY_POOL}" \
    --location="${REGION}" \
    --project="${PROJECT_ID}" \
    --description="GitHub Actions for superadmin repo" \
    2>/dev/null || info "Pool already exists, skipping."

  POOL_NAME="projects/${PROJECT_ID}/locations/${REGION}/workloadIdentityPools/${WORKLOAD_IDENTITY_POOL}"

  gcloud iam workload-identity-pools providers create-github "${WORKLOAD_IDENTITY_PROVIDER}" \
    --location="${REGION}" \
    --workload-identity-pool="${WORKLOAD_IDENTITY_POOL}" \
    --project="${PROJECT_ID}" \
    --attribute-mapping="google.subject=assertion.sub,actor=assertion.actor,repository=assertion.repository" \
    --attribute-condition="repository=='designfoundry-ai/designfoundry-ea-superadmin'" \
    2>/dev/null || info "Provider already exists, skipping."

  PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')

  gcloud iam service-accounts add-iam-policy-binding "${GITHUB_DEPLOYER_SA_EMAIL}" \
    --project="${PROJECT_ID}" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://${POOL_NAME}/repository/designfoundry-ai/designfoundry-ea-superadmin" \
    --quiet 2>/dev/null || info "WIF binding already exists"

  WI_PROVIDER_FULL="projects/${PROJECT_NUMBER}/locations/${REGION}/workloadIdentityPools/${WORKLOAD_IDENTITY_POOL}/providers/${WORKLOAD_IDENTITY_PROVIDER}"
  success "WIF configured"
}

# ── Secrets ────────────────────────────────────────────────────────────────────
create_secrets() {
  section "Creating Secrets"

  # JWT secret for NextAuth
  local ADMIN_JWT_SECRET
  ADMIN_JWT_SECRET=$(openssl rand -hex 32)
  create_secret "superadmin-jwt-secret" "${ADMIN_JWT_SECRET}"

  # Store public key for verification by EA instances
  create_secret_from_file "superadmin-license-public-key" "${KEYS_DIR}/public.pem"

  success "Secrets created"
}

# ── IAM for Artifact Registry ──────────────────────────────────────────────────
grant_artifact_registry() {
  section "Granting Artifact Registry Access"

  gcloud artifacts repositories add-iam-policy-binding "${ARTIFACT_REPO}" \
    --location="${REGION}" \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${GITHUB_DEPLOYER_SA_EMAIL}" \
    --role="roles/artifactregistry.writer" \
    --quiet 2>/dev/null || true

  success "Artifact Registry IAM set"
}

# ── Summary ───────────────────────────────────────────────────────────────────
print_summary() {
  section "Setup Complete"

  echo ""
  echo -e "${BOLD}Project:${RESET}          ${PROJECT_ID}"
  echo -e "${BOLD}Region:${RESET}          ${REGION}"
  echo -e "${BOLD}Artifact Registry:${RESET}  ${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}"
  echo -e "${BOLD}Cloud SQL:${RESET}       ${CLOUD_SQL_INSTANCE} (${REGION})"
  echo -e "${BOLD}Cloud Run:${RESET}       ${CLOUD_RUN_SERVICE}"
  echo -e "${BOLD}Pub/Sub topic:${RESET}   platform-events"
  echo -e "${BOLD}Superadmin SA:${RESET}   ${SUPERADMIN_SA_EMAIL}"
  echo -e "${BOLD}Deployer SA:${RESET}     ${GITHUB_DEPLOYER_SA_EMAIL}"
  echo ""
  echo -e "${BOLD}WIF Provider:${RESET}"
  echo "  ${WI_PROVIDER_FULL}"
  echo ""
  echo -e "${BOLD}${RED}IMPORTANT — Save these:${RESET}"
  echo ""
  echo "  1. superadmin-jwt-secret:"
  echo "     gcloud secrets versions list superadmin-jwt-secret --project=${PROJECT_ID}"
  echo ""
  echo "  2. superadmin-database-url:"
  echo "     gcloud secrets versions list superadmin-database-url --project=${PROJECT_ID}"
  echo "     (Cloud Run env var: ADMIN_DATABASE_URL)"
  echo ""
  echo "  3. RSA private key:"
  echo "     cat ${KEYS_DIR}/private.pem"
  echo "     (add to GitHub Secrets: RSA_PRIVATE_KEY)"
  echo ""
  echo "  4. License public key (for EA instances):"
  echo "     cat ${KEYS_DIR}/public.pem"
  echo "     (distribute to each EA instance for license validation)"
  echo ""
  echo "  5. GitHub Environment variables to set:"
  echo "     ADMIN_DATABASE_URL    = (from superadmin-database-url secret)"
  echo "     RSA_PRIVATE_KEY       = (the full private.pem content as a secret)"
  echo "     LICENSE_KEY_ID        = ${LICENCE_KEY_ID}"
  echo ""
  echo "  6. WIF Provider (GitHub variable):"
  echo "     GCP_WORKLOAD_IDENTITY_PROVIDER = ${WI_PROVIDER_FULL}"
  echo ""
}

# ── Main ────────────────────────────────────────────────────────────────────────
main() {
  check_gcloud
  enable_apis
  create_service_accounts
  grant_sa_roles
  create_artifact_registry
  grant_artifact_registry
  setup_wif
  generate_license_keys
  create_secrets
  create_cloudsql
  create_pubsub
  print_summary
}

main "$@"
