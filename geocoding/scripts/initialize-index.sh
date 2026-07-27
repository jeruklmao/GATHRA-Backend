#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

require_command jq
ensure_data_layout

candidate="${1:-}"
validate_index_name "${candidate}"
candidate_config="$(candidate_config_host_path "${candidate}")"
candidate_container_config="$(candidate_config_container_path "${candidate}")"

if [[ -e "${candidate_config}" ]]; then
  echo "Candidate config already exists: ${candidate_config}" >&2
  echo "Choose a new versioned candidate name." >&2
  exit 2
fi

jq --arg index "${candidate}" \
  '.api.indexName = $index | .schema.indexName = $index' \
  "${PELIAS_CONFIG_SOURCE}" > "${candidate_config}"

compose_import up -d --wait pelias-elasticsearch
compose_import run --rm \
  -e "PELIAS_CONFIG=${candidate_container_config}" \
  pelias-schema ./bin/create_index

echo "Created candidate index ${candidate}."

