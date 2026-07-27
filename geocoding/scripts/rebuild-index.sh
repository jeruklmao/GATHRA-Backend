#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

candidate=""
confirmed=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --candidate)
      candidate="${2:-}"
      shift 2
      ;;
    --yes)
      confirmed=true
      shift
      ;;
    *)
      echo "Usage: $0 --candidate gathra-geocoder-vYYYYMMDDHHMM --yes" >&2
      exit 2
      ;;
  esac
done

validate_index_name "${candidate}"
if [[ "${confirmed}" != true ]]; then
  echo "A rebuild downloads/imports data and may use substantial RAM and disk." >&2
  echo "Re-run with --yes after checking free space and backups." >&2
  exit 2
fi

osm_file="${DATA_DIR}/openstreetmap/gathra-supported-region.osm.pbf"
if [[ ! -f "${osm_file}" ]]; then
  echo "Missing ${osm_file}; prepare the region extract first." >&2
  exit 2
fi

"${SCRIPT_DIR}/initialize-index.sh" "${candidate}"
"${SCRIPT_DIR}/import-wof.sh" "${candidate}"
"${SCRIPT_DIR}/prepare-placeholder.sh"
"${SCRIPT_DIR}/import-osm.sh" "${candidate}"
"${SCRIPT_DIR}/import-custom-poi.sh" "${candidate}"

candidate_config="$(candidate_config_container_path "${candidate}")"
cleanup_candidate_api() {
  compose_all_geocoding stop pelias-api-candidate >/dev/null 2>&1 || true
}
trap cleanup_candidate_api EXIT

GATHRA_PELIAS_CANDIDATE_CONFIG="${candidate_config}" \
  compose_all_geocoding up -d --wait \
    pelias-libpostal pelias-placeholder pelias-pip pelias-api-candidate

"${SCRIPT_DIR}/run-quality-tests.sh" --candidate "${candidate}"
"${SCRIPT_DIR}/switch-index-alias.sh" "${candidate}"

echo "Candidate ${candidate} passed raw-index quality checks and now serves the read alias."
echo "Start the normalized stack, then rerun run-quality-tests.sh before deleting any old index."

