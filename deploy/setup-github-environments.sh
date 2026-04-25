#!/usr/bin/env bash
# setup-github-environments.sh
# Creates staging + production GitHub Environments for designfoundry-ea-superadmin
# Run AFTER deploy/setup-gcp.sh — values come from that script's output.
#
# Usage:
#   GITHUB_ORG=designfoundry-ai \
#   REPO=designfoundry-ea-superadmin \
#   WI_PROVIDER_STAGING="projects/123456789/locations/europe-central2/workloadIdentityPools/superadmin-pool/providers/superadmin-github" \
#   WI_PROVIDER_PRODUCTION="projects/987654321/locations/europe-central2/workloadIdentityPools/superadmin-pool/providers/superadmin-github" \
#   JWT_SECRET_STAGING="abc123..." \
#   JWT_SECRET_PRODUCTION="xyz789..." \
#   ./setup-github-environments.sh

set -euo pipefail

GITHUB_ORG="${GITHUB_ORG:-designfoundry-ai}"
REPO="${REPO:-designfoundry-ea-superadmin}"
WI_PROVIDER_STAGING="${WI_PROVIDER_STAGING:?Need Workload Identity Provider for staging}"
WI_PROVIDER_PRODUCTION="${WI_PROVIDER_PRODUCTION:?Need Workload Identity Provider for production}"
JWT_SECRET_STAGING="${JWT_SECRET_STAGING:?Need JWT secret for staging}"
JWT_SECRET_PRODUCTION="${JWT_SECRET_PRODUCTION:?Need JWT secret for production}"

REPO_API="repos/${GITHUB_ORG}/${REPO}"
GH="gh api --header \"X-GitHub-Api-Version:2022-11-28\""

echo "==> Setting up GitHub Environments for ${GITHUB_ORG}/${REPO}"

# ── Helpers ──────────────────────────────────────────────────────────────────

create_env() {
  local name="$1"
  echo "==> Creating environment: ${name}..."
  # GitHub API returns 200 if already exists, so we don't check response
  $GH "${REPO_API}/environments" -f name="${name}" --silent 2>/dev/null || true
  echo "    ✓ environment '${name}' ready"
}

upsert_variable() {
  local env="$1"
  local var_name="$2"
  local var_value="$3"
  local body
  body=$(printf '{"name":"%s","value":"%s"}' "$var_name" "$var_value")
  echo "    Setting ${env}/${var_name}..."
  # Try update first, if fails try create
  $GH -H "Accept: application/vnd.github+json" \
    "${REPO_API}/environments/${env}/variables/${var_name}" \
    -X PATCH -f name="${var_name}" -f value="${var_value}" \
    --silent 2>/dev/null || \
  $GH -H "Accept: application/vnd.github+json" \
    "${REPO_API}/environments/${env}/variables" \
    -X POST -f name="${var_name}" -f value="${var_value}" \
    --silent 2>/dev/null
  echo "    ✓ ${env}/${var_name}"
}

upsert_secret() {
  local env="$1"
  local secret_name="$2"
  local secret_value="$3"
  echo "    Setting ${env} secret: ${secret_name}..."
  echo -n "$secret_value" | $GH -H "Accept: application/vnd.github+json" \
    "${REPO_API}/environments/${env}/secrets/${secret_name}" \
    -X PUT -F secret="$secret_value" \
    --silent 2>/dev/null
  echo "    ✓ ${env}/${secret_name} (updated)"
}

# ── Staging Environment ──────────────────────────────────────────────────────
echo ""
echo "━━━ STAGING ━━━"
create_env "staging"

upsert_variable "staging" "GCP_PROJECT_ID"               "designfoundry-superadmin-staging"
upsert_variable "staging" "GCP_REGION"                    "europe-central2"
upsert_variable "staging" "ARTIFACT_REGISTRY_REPO"       "superadmin"
upsert_variable "staging" "CLOUD_RUN_SERVICE"            "designfoundry-ea-superadmin-staging"
upsert_variable "staging" "SUPERADMIN_SERVICE_ACCOUNT"   "designfoundry-superadmin@designfoundry-superadmin-staging.iam.gserviceaccount.com"
upsert_variable "staging" "GCP_DEPLOYER_SERVICE_ACCOUNT"  "github-deployer@designfoundry-superadmin-staging.iam.gserviceaccount.com"
upsert_variable "staging" "GCP_WORKLOAD_IDENTITY_PROVIDER" "${WI_PROVIDER_STAGING}"
upsert_variable "staging" "STAGING_NEXT_PUBLIC_API_URL"   "https://staging.your-platform-domain/api/v1"

upsert_secret  "staging" "JWT_SECRET"                     "${JWT_SECRET_STAGING}"

# ── Production Environment ──────────────────────────────────────────────────
echo ""
echo "━━━ PRODUCTION ━━━"
create_env "production"

upsert_variable "production" "GCP_PROJECT_ID"               "designfoundry-superadmin-production"
upsert_variable "production" "GCP_REGION"                  "europe-central2"
upsert_variable "production" "ARTIFACT_REGISTRY_REPO"       "superadmin"
upsert_variable "production" "CLOUD_RUN_SERVICE"            "designfoundry-ea-superadmin"
upsert_variable "production" "SUPERADMIN_SERVICE_ACCOUNT"   "designfoundry-superadmin@designfoundry-superadmin-production.iam.gserviceaccount.com"
upsert_variable "production" "GCP_DEPLOYER_SERVICE_ACCOUNT"  "github-deployer@designfoundry-superadmin-production.iam.gserviceaccount.com"
upsert_variable "production" "GCP_WORKLOAD_IDENTITY_PROVIDER" "${WI_PROVIDER_PRODUCTION}"
upsert_variable "production" "NEXT_PUBLIC_API_URL"          "https://your-platform-domain/api/v1"

upsert_secret  "production" "JWT_SECRET"                    "${JWT_SECRET_PRODUCTION}"

echo ""
echo "============================================================"
echo "  GitHub Environments — Setup Complete"
echo "============================================================"
echo ""
echo "  Review at:"
echo "  https://github.com/${GITHUB_ORG}/${REPO}/settings/environments"
echo ""
echo "  Next: run deploy/setup-gcp.sh for staging + production projects"
echo "  then push to develop to trigger first staging deploy."
echo "============================================================"