#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

ensure_data_layout

if [[ ! -f "${DATA_DIR}/whosonfirst/.gathra-download-complete" ]]; then
  echo "Who's on First data is missing. Run import-wof.sh first." >&2
  exit 2
fi

compose_import run --rm pelias-placeholder-prepare ./cmd/extract.sh
compose_import run --rm pelias-placeholder-prepare ./cmd/build.sh
