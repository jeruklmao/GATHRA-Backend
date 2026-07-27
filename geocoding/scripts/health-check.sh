#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

require_command curl

compose_all_geocoding exec -T pelias-elasticsearch \
  curl --fail --silent \
  "http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow&timeout=3s" \
  >/dev/null

compose_all_geocoding exec -T pelias-api node -e \
  "fetch('http://127.0.0.1:4000/v1/autocomplete?text=Jakarta&size=1').then(async r=>{if(!r.ok)throw new Error(await r.text())}).catch(e=>{console.error(e.message);process.exit(1)})"

curl --fail --silent "http://127.0.0.1:${GATHRA_BACKEND_PORT:-3000}/api/v1/health" \
  >/dev/null

echo "Elasticsearch, private Pelias API, and public NestJS health checks passed."

