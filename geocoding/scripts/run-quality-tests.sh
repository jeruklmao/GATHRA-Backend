#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

candidate=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --candidate)
      candidate="${2:-}"
      shift 2
      ;;
    *)
      echo "Usage: $0 [--candidate INDEX]" >&2
      exit 2
      ;;
  esac
done

if [[ -n "${candidate}" ]]; then
  require_candidate_config "${candidate}"
  compose_all_geocoding run --rm \
    -e "GEOCODING_QUALITY_MODE=pelias" \
    -e "GEOCODING_QUALITY_BASE_URL=http://pelias-api-candidate:4001/v1" \
    pelias-quality /quality/run-quality-tests.mjs
else
  compose_all_geocoding run --rm \
    -e "GEOCODING_QUALITY_MODE=backend" \
    -e "GEOCODING_QUALITY_BASE_URL=http://backend:3000/api/v1/geocoding" \
    pelias-quality /quality/run-quality-tests.mjs
fi

