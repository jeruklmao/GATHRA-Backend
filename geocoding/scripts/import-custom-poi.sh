#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

candidate="${1:-}"
require_candidate_config "${candidate}"
source_csv="${GEOCODING_DIR}/custom-poi/gathra-poi.csv"
destination_csv="${DATA_DIR}/csv/gathra-poi.csv"

install -m 0644 "${source_csv}" "${destination_csv}"
run_candidate_job pelias-csv-import "${candidate}" ./bin/start

