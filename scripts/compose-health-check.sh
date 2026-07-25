#!/usr/bin/env sh
set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKEND_DIRECTORY=$(CDPATH= cd -- "${SCRIPT_DIRECTORY}/.." && pwd)
WAIT_SECONDS=${COMPOSE_WAIT_SECONDS:-300}

compose() {
  docker compose --project-directory "${BACKEND_DIRECTORY}" \
    --file "${BACKEND_DIRECTORY}/compose.yaml" "$@"
}

cleanup() {
  compose down
}
trap cleanup EXIT INT TERM

compose up --build --detach --wait --wait-timeout "${WAIT_SECONDS}"

curl --fail --silent --show-error \
  "http://127.0.0.1:${GATHRA_BACKEND_PORT:-3000}/api/v1/health" \
  | jq --exit-status '.status == "ok" and .checks.routing == "up"' >/dev/null

curl --fail --silent --show-error \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{
    "origin":{"latitude":-6.2000,"longitude":106.8167},
    "destination":{"latitude":-6.1900,"longitude":106.8272},
    "travelMode":"CAR",
    "alternatives":1
  }' \
  "http://127.0.0.1:${GATHRA_BACKEND_PORT:-3000}/api/v1/routes/preview" \
  | jq --exit-status '
      (.routes | length) == 2
      and .metadata.travelMode == "CAR"
      and .routes[0].isRecommended == true
      and .routes[0].geometry.type == "LineString"
      and (.routes[0].geometry.coordinates | length) >= 2
      and .routes[0].summary.distanceMeters > 0
      and .routes[0].summary.durationSeconds > 0
    ' >/dev/null

curl --fail --silent --show-error \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{
    "origin":{"latitude":-6.2000,"longitude":106.8167},
    "destination":{"latitude":-6.1900,"longitude":106.8272},
    "travelMode":"MOTORCYCLE",
    "alternatives":1
  }' \
  "http://127.0.0.1:${GATHRA_BACKEND_PORT:-3000}/api/v1/routes/preview" \
  | jq --exit-status '
      (.routes | length) == 2
      and .metadata.travelMode == "MOTORCYCLE"
      and .routes[0].isRecommended == true
      and .routes[0].geometry.type == "LineString"
      and (.routes[0].geometry.coordinates | length) >= 2
      and .routes[0].summary.distanceMeters > 0
      and .routes[0].summary.durationSeconds > 0
    ' >/dev/null

curl --silent --show-error \
  --request POST \
  --header "Content-Type: application/json" \
  --data '{
    "origin":{"latitude":-7.2575,"longitude":112.7521},
    "destination":{"latitude":-7.2600,"longitude":112.7600},
    "travelMode":"CAR",
    "alternatives":1
  }' \
  "http://127.0.0.1:${GATHRA_BACKEND_PORT:-3000}/api/v1/routes/preview" \
  | jq --exit-status '
      .error.code == "NO_ROUTE"
      and .error.retryable == false
    ' >/dev/null

echo "GATHRA backend, CAR/MOTORCYCLE previews, and private GraphHopper service are healthy."
