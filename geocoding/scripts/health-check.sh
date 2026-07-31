#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE=(
  docker compose
  --project-directory "${BACKEND_DIR}"
  --file "${BACKEND_DIR}/compose.yaml"
)

"${COMPOSE[@]}" exec -T photon \
  curl --fail --silent \
  "http://127.0.0.1:2322/api?q=Jakarta&limit=1&bbox=106.479,-6.437,106.955,-6.025" \
  >/dev/null

curl --fail --silent "http://127.0.0.1:${GATHRA_BACKEND_PORT:-3000}/api/v1/health" \
  | jq --exit-status \
    '.status == "ok" and .checks.routing == "up" and .checks.geocoding == "up"' \
  >/dev/null

echo "Private Photon and public NestJS geocoding health checks passed."
