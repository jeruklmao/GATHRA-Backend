#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

index_name=""
confirmation=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --index)
      index_name="${2:-}"
      shift 2
      ;;
    --confirm)
      confirmation="${2:-}"
      shift 2
      ;;
    *)
      echo "Usage: $0 --index NAME --confirm NAME" >&2
      exit 2
      ;;
  esac
done

validate_index_name "${index_name}"
if [[ "${confirmation}" != "${index_name}" ]]; then
  echo "Deletion requires --confirm with the exact physical index name." >&2
  exit 2
fi

alias_name="gathra-geocoder-read"
if compose_import exec -T pelias-elasticsearch \
  curl --fail --silent \
  "http://127.0.0.1:9200/${index_name}/_alias/${alias_name}" >/dev/null 2>&1; then
  echo "Refusing to delete the index currently serving ${alias_name}." >&2
  exit 2
fi

compose_import exec -T pelias-elasticsearch \
  curl --fail --silent -X DELETE \
  "http://127.0.0.1:9200/${index_name}" >/dev/null
echo "Deleted physical index ${index_name}. This cannot be undone without a backup."

