#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

require_command jq
ensure_data_layout
candidate="${1:-}"
validate_index_name "${candidate}"
alias_name="gathra-geocoder-read"

compose_import up -d --wait pelias-elasticsearch

if ! compose_import exec -T pelias-elasticsearch \
  curl --fail --silent "http://127.0.0.1:9200/${candidate}/_count" >/dev/null; then
  echo "Candidate index does not exist: ${candidate}" >&2
  exit 2
fi

current_json="$(
  compose_import exec -T pelias-elasticsearch \
    curl --silent "http://127.0.0.1:9200/_alias/${alias_name}?ignore_unavailable=true"
)"
mapfile -t previous_indexes < <(jq -r 'keys[]?' <<<"${current_json}")

actions='[]'
for previous in "${previous_indexes[@]}"; do
  actions="$(jq --arg index "${previous}" --arg alias "${alias_name}" \
    '. + [{"remove":{"index":$index,"alias":$alias}}]' <<<"${actions}")"
done
actions="$(jq --arg index "${candidate}" --arg alias "${alias_name}" \
  '. + [{"add":{"index":$index,"alias":$alias}}]' <<<"${actions}")"
payload="$(jq -n --argjson actions "${actions}" '{actions:$actions}')"

compose_import exec -T pelias-elasticsearch \
  curl --fail --silent \
    -H "Content-Type: application/json" \
    -X POST \
    --data-binary "${payload}" \
    "http://127.0.0.1:9200/_aliases" >/dev/null

jq -n \
  --arg alias "${alias_name}" \
  --arg to "${candidate}" \
  --arg switchedAt "$(date --utc +%FT%TZ)" \
  --argjson from "$(printf '%s\n' "${previous_indexes[@]}" | jq -Rsc 'split("\n") | map(select(length > 0))')" \
  '{alias:$alias,from:$from,to:$to,switchedAt:$switchedAt}' \
  > "${DATA_DIR}/rollback/last-switch.json"

echo "Alias ${alias_name} now points to ${candidate}."
if [[ ${#previous_indexes[@]} -gt 0 ]]; then
  echo "Previous index retained for rollback: ${previous_indexes[*]}"
fi

