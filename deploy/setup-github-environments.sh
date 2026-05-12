#!/usr/bin/env bash
# setup-github-environments.sh
# Creates staging + production GitHub Environments for designfoundry-ea-superadmin
# Run AFTER deploy/setup-gcp.sh — values come from that script's output.
#
# Usage:
#   GITHUB_ORG=designfoundry-ai \
#   REPO=designfoundry-ea-superadmin \
#   WI_PROVIDER_STAGING="projects/123456789/locations/global/workloadIdentityPools/superadmin-pool/providers/superadmin-github" \
#   WI_PROVIDER_PRODUCTION="projects/987654321/locations/global/workloadIdentityPools/superadmin-pool/providers/superadmin-github" \
#   JWT_SECRET_STAGING="abc123..." \
#   JWT_SECRET_PRODUCTION="xyz789..." \
#   ./setup-github-environments.sh
#
# Prerequisites:
#   - gh CLI authenticated (gh auth login)
#   - Write access to the repo's environments + secrets

set -euo pipefail

GITHUB_ORG="${GITHUB_ORG:-designfoundry-ai}"
REPO="${REPO:-designfoundry-ea-superadmin}"
WI_PROVIDER_STAGING="${WI_PROVIDER_STAGING:?Need Workload Identity Provider for staging}"
WI_PROVIDER_PRODUCTION="${WI_PROVIDER_PRODUCTION:?Need Workload Identity Provider for production}"
JWT_SECRET_STAGING="${JWT_SECRET_STAGING:?Need JWT secret for staging}"
JWT_SECRET_PRODUCTION="${JWT_SECRET_PRODUCTION:?Need JWT secret for production}"

REPO_FULL="${GITHUB_ORG}/${REPO}"
REPO_API="repos/${REPO_FULL}"
GH_API_VERSION_HEADER=(--header "X-GitHub-Api-Version:2022-11-28")

echo "==> Setting up GitHub Environments for ${REPO_FULL}"

# ── Helpers ──────────────────────────────────────────────────────────────────

# Create environment (idempotent — PUT semantics: returns 200 whether new or existing).
create_env() {
  local name="$1"
  echo "==> Creating environment: ${name}..."
  gh api "${GH_API_VERSION_HEADER[@]}" \
    "${REPO_API}/environments/${name}" \
    -X PUT \
    --silent >/dev/null
  echo "    ✓ environment '${name}' ready"
}

# Upsert a non-secret environment variable.
# `gh variable set` handles create-or-update transparently.
upsert_variable() {
  local env="$1"
  local var_name="$2"
  local var_value="$3"
  echo "    Setting ${env}/${var_name}..."
  gh variable set "${var_name}" \
    --env "${env}" \
    --repo "${REPO_FULL}" \
    --body "${var_value}" \
    >/dev/null
  echo "    ✓ ${env}/${var_name}"
}

# Upsert an environment secret. Must use `gh secret set` (which seals the
# value with the environment's libsodium public key); raw `gh api` cannot
# do this because the REST API requires the value already encrypted.
upsert_secret() {
  local env="$1"
  local secret_name="$2"
  local secret_value="$3"
  echo "    Setting ${env} secret: ${secret_name}..."
  gh secret set "${secret_name}" \
    --env "${env}" \
    --repo "${REPO_FULL}" \
    --body "${secret_value}" \
    >/dev/null
  echo "    ✓ ${env}/${secret_name}"
}

# ── Staging Environment ──────────────────────────────────────────────────────
echo ""
echo "━━━ STAGING ━━━"
create_env "staging"

upsert_variable "staging" "GCP_PROJECT_ID"                  "designfoundry-admin-staging"
upsert_variable "staging" "GCP_REGION"                      "europe-central2"
upsert_variable "staging" "ARTIFACT_REGISTRY_REPO"          "superadmin"
upsert_variable "staging" "CLOUD_RUN_SERVICE"               "designfoundry-ea-superadmin-staging"
upsert_variable "staging" "SUPERADMIN_SERVICE_ACCOUNT"      "designfoundry-superadmin@designfoundry-admin-staging.iam.gserviceaccount.com"
upsert_variable "staging" "GCP_DEPLOYER_SERVICE_ACCOUNT"    "github-deployer@designfoundry-admin-staging.iam.gserviceaccount.com"
upsert_variable "staging" "GCP_WORKLOAD_IDENTITY_PROVIDER"  "${WI_PROVIDER_STAGING}"
upsert_variable "staging" "STAGING_NEXT_PUBLIC_API_URL"     "https://staging.your-platform-domain/api/v1"

upsert_secret   "staging" "JWT_SECRET"                      "${JWT_SECRET_STAGING}"

# ── Production Environment ──────────────────────────────────────────────────
echo ""
echo "━━━ PRODUCTION ━━━"
create_env "production"

upsert_variable "production" "GCP_PROJECT_ID"                  "designfoundry-admin-production"
upsert_variable "production" "GCP_REGION"                      "europe-central2"
upsert_variable "production" "ARTIFACT_REGISTRY_REPO"          "superadmin"
upsert_variable "production" "CLOUD_RUN_SERVICE"               "designfoundry-ea-superadmin"
upsert_variable "production" "SUPERADMIN_SERVICE_ACCOUNT"      "designfoundry-superadmin@designfoundry-admin-production.iam.gserviceaccount.com"
upsert_variable "production" "GCP_DEPLOYER_SERVICE_ACCOUNT"    "github-deployer@designfoundry-admin-production.iam.gserviceaccount.com"
upsert_variable "production" "GCP_WORKLOAD_IDENTITY_PROVIDER"  "${WI_PROVIDER_PRODUCTION}"
upsert_variable "production" "NEXT_PUBLIC_API_URL"             "https://your-platform-domain/api/v1"

upsert_secret   "production" "JWT_SECRET"                      "${JWT_SECRET_PRODUCTION}"

echo ""
echo "============================================================"
echo "  GitHub Environments — Setup Complete"
echo "============================================================"
echo ""
echo "  Review at:"
echo "  https://github.com/${REPO_FULL}/settings/environments"
echo ""
echo "  Next: run deploy/setup-gcp.sh for staging + production projects"
echo "  then push to develop to trigger first staging deploy."
echo "============================================================"
