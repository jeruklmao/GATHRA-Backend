#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GEOCODING_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="$(cd -- "${GEOCODING_DIR}/.." && pwd)"
COMPOSE=(
  docker compose
  --project-directory "${BACKEND_DIR}"
  --file "${BACKEND_DIR}/compose.yaml"
)

mode="backend"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --raw-photon)
      mode="photon"
      shift
      ;;
    *)
      echo "Usage: $0 [--raw-photon]" >&2
      exit 2
      ;;
  esac
done

if [[ "${mode}" == "photon" ]]; then
  base_url="http://photon:2322"
else
  base_url="http://backend:3000/api/v1/geocoding"
fi

"${COMPOSE[@]}" run --rm --no-deps \
  -e "GEOCODING_QUALITY_MODE=${mode}" \
  -e "GEOCODING_QUALITY_BASE_URL=${base_url}" \
  -e "GEOCODING_QUALITY_CORPUS=/quality/geocoding-quality-corpus.json" \
  -e "GEOCODING_QUALITY_REGION_CONFIG=/region/region-config.json" \
  -e "GEOCODING_QUALITY_ADMIN_BOUNDARIES=/region/administrative-boundaries.geojson" \
  -e "GEOCODING_QUALITY_REQUIRE_VERIFIED=${GEOCODING_QUALITY_REQUIRE_VERIFIED:-false}" \
  -v "${GEOCODING_DIR}/quality:/quality:ro" \
  -v "${GEOCODING_DIR}/region:/region:ro" \
  backend node /quality/run-quality-tests.mjs
