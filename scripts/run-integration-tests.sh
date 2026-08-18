#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$project_dir/compose.test.yaml"

cleanup() {
  docker compose -f "$compose_file" down --volumes --remove-orphans >/dev/null
}
trap cleanup EXIT

docker compose -f "$compose_file" up --detach --wait
export DATABASE_URL="postgresql://gathra_test:gathra-test-only@127.0.0.1:55432/gathra_test"
export IOT_GATEWAY_TOKEN_SHA256="$(printf '%s' 'integration-gateway-token' | sha256sum | cut -d' ' -f1)"
npx jest --config test/jest-integration.json --runInBand
