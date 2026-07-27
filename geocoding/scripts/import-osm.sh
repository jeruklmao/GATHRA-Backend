#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

candidate="${1:-}"
require_candidate_config "${candidate}"
osm_file="${DATA_DIR}/openstreetmap/gathra-supported-region.osm.pbf"

if [[ ! -f "${osm_file}" ]]; then
  echo "Regional OSM extract not found: ${osm_file}" >&2
  echo "Run prepare-region-extract.sh first." >&2
  exit 2
fi

run_candidate_job pelias-osm-import "${candidate}" ./bin/start

