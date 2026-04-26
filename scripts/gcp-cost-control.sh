#!/usr/bin/env bash
# GCP Cost Control — start/stop staging or production infrastructure
# Run from your Mac mini (requires gcloud auth + project access)
# Compatible with Bash 3.2 (macOS default)
#
# Usage:
#   ./gcp-cost-control.sh staging --stop
#   ./gcp-cost-control.sh production --start
#   ./gcp-cost-control.sh all --status

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
  local env="$2"

  local service
  service=$(gcloud run services list --platform=managed --region="${REGION}" \
    --project="${project}" \
    --format="value(metadata.name)" 2>/dev/null | grep -E "designfoundry-admin-${env}|designfoundry-ea-${env}|superadmin" | head -n1)

  if [[ -z "${service}" ]]; then
    # Fallback to default naming convention
    if [[ "${project}" == *"admin"* ]]; then
      echo "designfoundry-admin-${env}"
    else
      echo "designfoundry-ea-${env}"
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
    --max-instances=0 \
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
stop_cloudsql() {
  local project="$1"
  local instance_name="$2"

  info "Stopping Cloud SQL: ${instance_name} (${project})"

  local state
  state=$(gcloud sql instances describe "${instance_name}" \
    --project="${project}" \
    --format="value(state)" 2>/dev/null || echo "UNKNOWN")

  if [[ "${state}" == "STOPPED" ]]; then
    info "  ${instance_name} already stopped"
    return 0
  fi

  gcloud sql instances patch "${instance_name}" \
    --project="${project}" \
    --no-backup \
    --quiet 2>&1 || {
      warn "  Cloud SQL stop failed — instance may use public IP or lack VPC connector"
      return 0
    }

  success "  ${instance_name} stopped"
}

# ── Start Cloud SQL instance ────────────────────────────────────────────────────
start_cloudsql() {
  local project="$1"
  local instance_name="$2"

  info "Starting Cloud SQL: ${instance_name} (${project})"

  gcloud sql instances patch "${instance_name}" \
    --project="${project}" \
    --backup \
    --quiet 2>&1 || warn "  Cloud SQL start failed"

  success "  ${instance_name} started"
}

# ── Status environment ──────────────────────────────────────────────────────────
status_environment() {
  local env="$1"

  # Project IDs per environment
  case "${env}" in
    staging)
      local superadmin_project="designfoundry-admin-staging"
      local ea_project="designfoundry-ea-staging"
      ;;
    production)
      local superadmin_project="designfoundry-admin-production"
      local ea_project="designfoundry-ea-production"
      ;;
    *)
      error "Unknown environment: ${env}"
      return 1
      ;;
  esac

  section "Environment: ${env^}"

  # Superadmin Cloud Run
  echo -e "  ${BOLD}Superadmin (${superadmin_project})${RESET}"
  local sa_service
  sa_service=$(resolve_service_name "${superadmin_project}" "${env}")
  local sa_url sa_min sa_max
  sa_url=$(gcloud run services describe "${sa_service}" \
    --region="${REGION}" --project="${superadmin_project}" \
    --format="value(status.url)" 2>/dev/null || echo "NOT FOUND")
  sa_min=$(gcloud run services describe "${sa_service}" \
    --region="${REGION}" --project="${superadmin_project}" \
    --format="value(spec.template.metadata.annotations.autoscaling.knative.dev/minScale)" 2>/dev/null || echo "?")
  sa_max=$(gcloud run services describe "${sa_service}" \
    --region="${REGION}" --project="${superadmin_project}" \
    --format="value(spec.template.metadata.annotations.autoscaling.knative.dev/maxScale)" 2>/dev/null || echo "?")
  echo -e "    Cloud Run: ${sa_url}"
  echo -e "    Scale:    min=${sa_min} max=${sa_max}"

  # EA Platform Cloud Run
  echo -e "  ${BOLD}EA Platform (${ea_project})${RESET}"
  local ea_service
  ea_service=$(resolve_service_name "${ea_project}" "${env}")
  local ea_url ea_min ea_max
  ea_url=$(gcloud run services describe "${ea_service}" \
    --region="${REGION}" --project="${ea_project}" \
    --format="value(status.url)" 2>/dev/null || echo "NOT FOUND")
  ea_min=$(gcloud run services describe "${ea_service}" \
    --region="${REGION}" --project="${ea_project}" \
    --format="value(spec.template.metadata.annotations.autoscaling.knative.dev/minScale)" 2>/dev/null || echo "?")
  ea_max=$(gcloud run services describe "${ea_service}" \
    --region="${REGION}" --project="${ea_project}" \
    --format="value(spec.template.metadata.annotations.autoscaling.knative.dev/maxScale)" 2>/dev/null || echo "?")
  echo -e "    Cloud Run: ${ea_url}"
  echo -e "    Scale:    min=${ea_min} max=${ea_max}"

  # Cloud SQL
  echo -e "  ${BOLD}Cloud SQL${RESET}"
  local sql_instance="superadmin-${env}"
  local sql_state sql_tier
  sql_state=$(gcloud sql instances describe "${sql_instance}" \
    --project="${superadmin_project}" \
    --format="value(state)" 2>/dev/null || echo "NOT FOUND")
  sql_tier=$(gcloud sql instances describe "${sql_instance}" \
    --project="${superadmin_project}" \
    --format="value(settings.tier)" 2>/dev/null || echo "N/A")
  echo -e "    ${sql_instance}: ${sql_tier} — ${sql_state}"
}

# ── Stop environment ─────────────────────────────────────────────────────────────
stop_environment() {
  local env="$1"

  case "${env}" in
    staging)
      local superadmin_project="designfoundry-admin-staging"
      local ea_project="designfoundry-ea-staging"
      ;;
    production)
      local superadmin_project="designfoundry-admin-production"
      local ea_project="designfoundry-ea-production"
      ;;
  esac

  section "Stopping ${env^}"

  local sa_service
  sa_service=$(resolve_service_name "${superadmin_project}" "${env}")
  stop_cloudrun "${superadmin_project}" "${sa_service}"

  local ea_service
  ea_service=$(resolve_service_name "${ea_project}" "${env}")
  stop_cloudrun "${ea_project}" "${ea_service}"

  local sql_instance="superadmin-${env}"
  stop_cloudsql "${superadmin_project}" "${sql_instance}"

  success "${env^} stopped"
}

# ── Start environment ───────────────────────────────────────────────────────────
start_environment() {
  local env="$1"

  case "${env}" in
    staging)
      local superadmin_project="designfoundry-admin-staging"
      local ea_project="designfoundry-ea-staging"
      ;;
    production)
      local superadmin_project="designfoundry-admin-production"
      local ea_project="designfoundry-ea-production"
      ;;
  esac

  section "Starting ${env^}"

  local sa_service
  sa_service=$(resolve_service_name "${superadmin_project}" "${env}")
  start_cloudrun "${superadmin_project}" "${sa_service}" "0" "2"

  local ea_service
  ea_service=$(resolve_service_name "${ea_project}" "${env}")
  start_cloudrun "${ea_project}" "${ea_service}" "1" "2"

  local sql_instance="superadmin-${env}"
  start_cloudsql "${superadmin_project}" "${sql_instance}"

  success "${env^} started"
}

# ── Usage ────────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}GCP Cost Control${RESET} — start/stop staging or production infrastructure
Compatible with Bash 3.2 (macOS default)

${BOLD}USAGE${RESET}
    ./gcp-cost-control.sh <environment> <action>
    ./gcp-cost-control.sh all --status

${BOLD}ENVIRONMENTS${RESET}
    staging     designfoundry-admin-staging + designfoundry-ea-staging
    production  designfoundry-admin-production + designfoundry-ea-production
    all         Both environments

${BOLD}ACTIONS${RESET}
    --stop     Scale Cloud Run to 0 instances, stop Cloud SQL
    --start    Scale Cloud Run back up, start Cloud SQL
    --status   Show current state of all resources

${BOLD}EXAMPLES${RESET}
    ./gcp-cost-control.sh staging --status
    ./gcp-cost-control.sh production --stop
    ./gcp-cost-control.sh all --start

${BOLD}PREREQUISITES${RESET}
    gcloud auth login
    gcloud config set project <your-project>
    IAM roles needed: roles/run.admin, roles/cloudsql.admin

${BOLD}NOTES${RESET}
    Cloud SQL stop requires Private IP + VPC Connector.
    Without it, Cloud SQL stop is not supported — script will warn.

    Cloud Run at 0 instances = free. Cloud SQL still costs when running.
    For maximum savings: stop both Cloud Run AND Cloud SQL.
EOF
  exit 1
}

# ── Main ────────────────────────────────────────────────────────────────────────
check_gcloud

if [[ $# -lt 2 ]]; then
  usage
fi

ENVIRONMENT="$1"
ACTION="$2"

case "${ACTION}" in
  --stop|--start|--status) ;;
  *)
    error "Unknown action: ${ACTION}"
    usage
    ;;
esac

case "${ENVIRONMENT}" in
  staging|production)
    case "${ACTION}" in
      --stop)    stop_environment "${ENVIRONMENT}" ;;
      --start)   start_environment "${ENVIRONMENT}" ;;
      --status)  status_environment "${ENVIRONMENT}" ;;
    esac
    ;;
  all)
    for env in staging production; do
      case "${ACTION}" in
        --stop)    stop_environment "${env}" ;;
        --start)   start_environment "${env}" ;;
        --status)  status_environment "${env}" ;;
      esac
    done
    ;;
  *)
    error "Unknown environment: ${ENVIRONMENT}"
    usage
    ;;
esac

echo ""
