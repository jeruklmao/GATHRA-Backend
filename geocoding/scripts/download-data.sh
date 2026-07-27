#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

require_command curl
require_command sha256sum
ensure_data_layout

force=false
if [[ "${1:-}" == "--force" ]]; then
  force=true
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--force]" >&2
  exit 2
fi

source_url="${GATHRA_GEOCODING_OSM_SOURCE_URL:-https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf}"
destination="${DATA_DIR}/source/java-latest.osm.pbf"
partial="${destination}.partial"

if [[ -f "${destination}" && "${force}" != true ]]; then
  echo "Source already exists: ${destination}"
  echo "Use --force only when intentionally refreshing the upstream snapshot."
  exit 0
fi

echo "Downloading ${source_url}"
curl --fail --location --retry 3 --retry-all-errors \
  --continue-at - \
  --output "${partial}" \
  "${source_url}"

mv -f -- "${partial}" "${destination}"
sha256sum "${destination}" > "${destination}.sha256"

if curl --fail --location --retry 2 \
  --output "${destination}.md5" \
  "${source_url}.md5"; then
  expected_md5="$(awk '{print $1}' "${destination}.md5")"
  actual_md5="$(md5sum "${destination}" | awk '{print $1}')"
  if [[ "${expected_md5}" != "${actual_md5}" ]]; then
    echo "Geofabrik MD5 mismatch for ${destination}" >&2
    exit 1
  fi
else
  echo "Upstream MD5 was unavailable; SHA-256 provenance was still recorded." >&2
fi

echo "Downloaded source and recorded checksums:"
cat "${destination}.sha256"

