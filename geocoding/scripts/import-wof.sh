#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

ensure_data_layout
candidate="${1:-}"
require_candidate_config "${candidate}"

download_marker="${DATA_DIR}/whosonfirst/.gathra-download-complete"
if [[ ! -f "${download_marker}" ]]; then
  echo "Downloading Who's on First Indonesia administrative data."
  compose_import run --rm pelias-wof-download ./bin/download
  touch "${download_marker}"
fi

run_candidate_job pelias-wof-import "${candidate}" ./bin/start
