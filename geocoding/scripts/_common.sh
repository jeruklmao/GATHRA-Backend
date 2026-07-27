#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GEOCODING_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="$(cd -- "${GEOCODING_DIR}/.." && pwd)"
PROJECT_DIR="$(cd -- "${BACKEND_DIR}/.." && pwd)"
COMPOSE_FILE="${BACKEND_DIR}/compose.yaml"
REGION_CONFIG="${GEOCODING_DIR}/region/region-config.json"
PELIAS_CONFIG_SOURCE="${GEOCODING_DIR}/pelias.json"

GEOCODING_DATA_DIR_INPUT="${GATHRA_GEOCODING_DATA_DIR:-./geocoding/data}"
case "${GEOCODING_DATA_DIR_INPUT}" in
  /*) DATA_DIR="${GEOCODING_DATA_DIR_INPUT}" ;;
  ./*) DATA_DIR="${BACKEND_DIR}/${GEOCODING_DATA_DIR_INPUT#./}" ;;
  *) DATA_DIR="${BACKEND_DIR}/${GEOCODING_DATA_DIR_INPUT}" ;;
esac

if [[ "${DATA_DIR}" == "/" || "${DATA_DIR}" == "${HOME}" || -z "${DATA_DIR}" ]]; then
  echo "Refusing unsafe GATHRA_GEOCODING_DATA_DIR: ${DATA_DIR}" >&2
  exit 2
fi

COMPOSE=(
  docker compose
  --project-directory "${BACKEND_DIR}"
  -f "${COMPOSE_FILE}"
)

compose_import() {
  "${COMPOSE[@]}" --profile geocoding-import "$@"
}

compose_all_geocoding() {
  "${COMPOSE[@]}" --profile geocoding --profile geocoding-import "$@"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 2
  fi
}

ensure_data_layout() {
  mkdir -p \
    "${DATA_DIR}/config" \
    "${DATA_DIR}/csv" \
    "${DATA_DIR}/openstreetmap" \
    "${DATA_DIR}/rollback" \
    "${DATA_DIR}/source" \
    "${DATA_DIR}/whosonfirst"
}

validate_index_name() {
  local index_name="${1:-}"
  if [[ ! "${index_name}" =~ ^gathra-geocoder-v[0-9]{12,14}$ ]]; then
    echo "Index must match gathra-geocoder-vYYYYMMDDHHMM[SS]." >&2
    exit 2
  fi
  if [[ "${index_name}" == "gathra-geocoder-read" ]]; then
    echo "The read alias cannot be used as a physical index name." >&2
    exit 2
  fi
}

candidate_config_host_path() {
  printf '%s/config/pelias-%s.json\n' "${DATA_DIR}" "$1"
}

candidate_config_container_path() {
  printf '/data/config/pelias-%s.json\n' "$1"
}

require_candidate_config() {
  local candidate="$1"
  local config_path
  validate_index_name "${candidate}"
  config_path="$(candidate_config_host_path "${candidate}")"
  if [[ ! -f "${config_path}" ]]; then
    echo "Candidate config not found: ${config_path}" >&2
    echo "Run initialize-index.sh ${candidate} first." >&2
    exit 2
  fi
}

run_candidate_job() {
  local service="$1"
  local candidate="$2"
  shift 2
  local config_path
  require_candidate_config "${candidate}"
  config_path="$(candidate_config_container_path "${candidate}")"
  compose_import run --rm \
    -e "PELIAS_CONFIG=${config_path}" \
    "${service}" "$@"
}
