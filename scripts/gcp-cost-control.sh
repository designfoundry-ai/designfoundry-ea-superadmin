#!/usr/bin/env bash
# GCP Cost Control — start/stop/status the production superadmin infrastructure
# Run from your Mac mini (requires gcloud auth + project access)
# Compatible with Bash 3.2 (macOS default)
#
# Admin is production-only; the script no longer takes an environment argument.
#
# Usage:
#   ./gcp-cost-control.sh status
#   ./gcp-cost-control.sh stop
#   ./gcp-cost-control.sh start

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Fixed config ─────────────────────────────────────────────────────────────
REGION="europe-central2"
SUPERADMIN_PROJECT="designfoundry-admin-production"
EA_PROJECT="designfoundry-ea-production"
SQL_INSTANCE="superadmin-production"

# ── Helpers ───────────────────────────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*"; }
success() { echo -e "${GREEN}[OK]${RESET}   $*"; }

section() {
  echo ""
  echo -e "${BOLD}${CYAN}═══ $1 ═══${RESET}"
}

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
}

# ── Resolve service name from project ───────────────────────────────────────────
resolve_service_name() {
  local project="$1"

  local service
  service=$(gcloud run services list --platform=managed --region="${REGION}" \
    --project="${project}" \
    --format="value(metadata.name)" 2>/dev/null | grep -E "designfoundry-admin-production|designfoundry-ea-production|superadmin" | head -n1)

  if [[ -z "${service}" ]]; then
    # Fallback to default naming convention
    if [[ "${project}" == *"admin"* ]]; then
      echo "designfoundry-admin-production"
    else
      echo "designfoundry-ea-production"
    fi
  else
    echo "${service}"
  fi
}

# ── Stop Cloud Run service ─────────────────────────────────────────────────────
stop_cloudrun() {
  local project="$1"
  local service="$2"

  info "Stopping Cloud Run: ${service} (${project})"

  local current_min
  current_min=$(gcloud run services describe "${service}" \
    --region="${REGION}" \
    --project="${project}" \
    --format="value(spec.template.metadata.annotations.autoscaling.knative.dev/minScale)" 2>/dev/null || echo "")
  local current_max
  current_max=$(gcloud run services describe "${service}" \
    --region="${REGION}" \
    --project="${project}" \
    --format="value(spec.template.metadata.annotations.autoscaling.knative.dev/maxScale)" 2>/dev/null || echo "")

  if [[ "${current_min}" == "0" && "${current_max}" == "0" ]]; then
    info "  ${service} already scaled to 0"
    return 0
  fi

  gcloud run services update "${service}" \
    --region="${REGION}" \
    --project="${project}" \
    --min-instances=0 \
    --quiet 2>&1

  success "  ${service} scaled to 0"
}

# ── Start Cloud Run service ─────────────────────────────────────────────────────
start_cloudrun() {
  local project="$1"
  local service="$2"
  local min_instances="${3:-1}"
  local max_instances="${4:-2}"

  info "Starting Cloud Run: ${service} (${project})"

  gcloud run services update "${service}" \
    --region="${REGION}" \
    --project="${project}" \
    --min-instances="${min_instances}" \
    --max-instances="${max_instances}" \
    --quiet 2>&1

  success "  ${service} scaled to ${min_instances}-${max_instances}"
}

# ── Stop Cloud SQL instance ─────────────────────────────────────────────────────
# Uses activation-policy=NEVER to actually stop the instance (compute billing pauses,
# storage billing continues). The previous --no-backup version only disabled backups
# and left the instance running, so it provided no cost savings.
stop_cloudsql() {
  local project="$1"
  local instance_name="$2"

  info "Stopping Cloud SQL: ${instance_name} (${project})"

  local policy
  policy=$(gcloud sql instances describe "${instance_name}" \
    --project="${project}" \
    --format="value(settings.activationPolicy)" 2>/dev/null || echo "UNKNOWN")

  if [[ "${policy}" == "NEVER" ]]; then
    info "  ${instance_name} already stopped (activationPolicy=NEVER)"
    return 0
  fi

  gcloud sql instances patch "${instance_name}" \
    --project="${project}" \
    --activation-policy=NEVER \
    --quiet 2>&1 || {
      warn "  Cloud SQL stop failed for ${instance_name}"
      return 0
    }

  success "  ${instance_name} stopped (activationPolicy=NEVER)"
}

# ── Start Cloud SQL instance ────────────────────────────────────────────────────
start_cloudsql() {
  local project="$1"
  local instance_name="$2"

  info "Starting Cloud SQL: ${instance_name} (${project})"

  local policy
  policy=$(gcloud sql instances describe "${instance_name}" \
    --project="${project}" \
    --format="value(settings.activationPolicy)" 2>/dev/null || echo "UNKNOWN")

  if [[ "${policy}" == "ALWAYS" ]]; then
    info "  ${instance_name} already running (activationPolicy=ALWAYS)"
    return 0
  fi

  gcloud sql instances patch "${instance_name}" \
    --project="${project}" \
    --activation-policy=ALWAYS \
    --quiet 2>&1 || warn "  Cloud SQL start failed"

  success "  ${instance_name} started (activationPolicy=ALWAYS)"
}

# ── Status ──────────────────────────────────────────────────────────────────────
status_environment() {
  section "Production"

  # Superadmin Cloud Run
  echo -e "  ${BOLD}Superadmin (${SUPERADMIN_PROJECT})${RESET}"
  local sa_service
  sa_service=$(resolve_service_name "${SUPERADMIN_PROJECT}")
  local sa_url sa_min sa_max
  sa_url=$(gcloud run services describe "${sa_service}" \
    --region="${REGION}" --project="${SUPERADMIN_PROJECT}" \
    --format="value(status.url)" 2>/dev/null || echo "NOT FOUND")
  sa_min=$(gcloud run services describe "${sa_service}" \
    --region="${REGION}" --project="${SUPERADMIN_PROJECT}" \
    --format="value(spec.template.metadata.annotations.autoscaling.knative.dev/minScale)" 2>/dev/null || echo "?")
  sa_max=$(gcloud run services describe "${sa_service}" \
    --region="${REGION}" --project="${SUPERADMIN_PROJECT}" \
    --format="value(spec.template.metadata.annotations.autoscaling.knative.dev/maxScale)" 2>/dev/null || echo "?")
  echo -e "    Cloud Run: ${sa_url}"
  echo -e "    Scale:    min=${sa_min} max=${sa_max}"

  # EA Platform Cloud Run
  echo -e "  ${BOLD}EA Platform (${EA_PROJECT})${RESET}"
  local ea_service
  ea_service=$(resolve_service_name "${EA_PROJECT}")
  local ea_url ea_min ea_max
  ea_url=$(gcloud run services describe "${ea_service}" \
    --region="${REGION}" --project="${EA_PROJECT}" \
    --format="value(status.url)" 2>/dev/null || echo "NOT FOUND")
  ea_min=$(gcloud run services describe "${ea_service}" \
    --region="${REGION}" --project="${EA_PROJECT}" \
    --format="value(spec.template.metadata.annotations.autoscaling.knative.dev/minScale)" 2>/dev/null || echo "?")
  ea_max=$(gcloud run services describe "${ea_service}" \
    --region="${REGION}" --project="${EA_PROJECT}" \
    --format="value(spec.template.metadata.annotations.autoscaling.knative.dev/maxScale)" 2>/dev/null || echo "?")
  echo -e "    Cloud Run: ${ea_url}"
  echo -e "    Scale:    min=${ea_min} max=${ea_max}"

  # Cloud SQL
  echo -e "  ${BOLD}Cloud SQL${RESET}"
  local sql_state sql_tier sql_policy
  sql_state=$(gcloud sql instances describe "${SQL_INSTANCE}" \
    --project="${SUPERADMIN_PROJECT}" \
    --format="value(state)" 2>/dev/null || echo "NOT FOUND")
  sql_tier=$(gcloud sql instances describe "${SQL_INSTANCE}" \
    --project="${SUPERADMIN_PROJECT}" \
    --format="value(settings.tier)" 2>/dev/null || echo "N/A")
  sql_policy=$(gcloud sql instances describe "${SQL_INSTANCE}" \
    --project="${SUPERADMIN_PROJECT}" \
    --format="value(settings.activationPolicy)" 2>/dev/null || echo "?")
  echo -e "    ${SQL_INSTANCE}: ${sql_tier} — state=${sql_state} activationPolicy=${sql_policy}"
}

# ── Stop ────────────────────────────────────────────────────────────────────────
stop_environment() {
  section "Stopping Production"

  local sa_service
  sa_service=$(resolve_service_name "${SUPERADMIN_PROJECT}")
  stop_cloudrun "${SUPERADMIN_PROJECT}" "${sa_service}"

  local ea_service
  ea_service=$(resolve_service_name "${EA_PROJECT}")
  stop_cloudrun "${EA_PROJECT}" "${ea_service}"

  stop_cloudsql "${SUPERADMIN_PROJECT}" "${SQL_INSTANCE}"

  success "Production stopped"
}

# ── Start ───────────────────────────────────────────────────────────────────────
start_environment() {
  section "Starting Production"

  local sa_service
  sa_service=$(resolve_service_name "${SUPERADMIN_PROJECT}")
  start_cloudrun "${SUPERADMIN_PROJECT}" "${sa_service}" "0" "2"

  local ea_service
  ea_service=$(resolve_service_name "${EA_PROJECT}")
  start_cloudrun "${EA_PROJECT}" "${ea_service}" "1" "2"

  start_cloudsql "${SUPERADMIN_PROJECT}" "${SQL_INSTANCE}"

  success "Production started"
}

# ── Usage ────────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}GCP Cost Control${RESET} — start/stop/status the production superadmin infrastructure
Admin is production-only. Compatible with Bash 3.2 (macOS default).

${BOLD}USAGE${RESET}
    ./gcp-cost-control.sh <action>

${BOLD}ACTIONS${RESET}
    stop     Scale Cloud Run to 0 instances, stop Cloud SQL
    start    Scale Cloud Run back up, start Cloud SQL
    status   Show current state of all production resources

${BOLD}EXAMPLES${RESET}
    ./gcp-cost-control.sh status
    ./gcp-cost-control.sh stop
    ./gcp-cost-control.sh start

${BOLD}PREREQUISITES${RESET}
    gcloud auth login
    IAM roles needed: roles/run.admin, roles/cloudsql.admin

${BOLD}NOTES${RESET}
    stop sets Cloud SQL activationPolicy=NEVER, which pauses compute billing
    (storage and backups continue to be billed at the usual rate).
    start patches it back to ALWAYS.

    Cloud Run at 0 instances = free. Cloud SQL compute is the big-ticket cost.
    For maximum savings: stop both Cloud Run AND Cloud SQL.
EOF
  exit 1
}

# ── Main ────────────────────────────────────────────────────────────────────────
check_gcloud

if [[ $# -lt 1 ]]; then
  usage
fi

ACTION="$1"

# Accept both bare ("stop") and legacy --flag ("--stop") forms so anyone with
# the old invocation muscle-memory still gets the right behavior.
case "${ACTION}" in
  stop|--stop)      stop_environment ;;
  start|--start)    start_environment ;;
  status|--status)  status_environment ;;
  *)
    error "Unknown action: ${ACTION}"
    usage
    ;;
esac

echo ""
