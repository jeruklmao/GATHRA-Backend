#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

require_command jq
require_command sha256sum
ensure_data_layout

force=false
if [[ "${1:-}" == "--force" ]]; then
  force=true
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--force]" >&2
  exit 2
fi

source_pbf="${GATHRA_GEOCODING_SOURCE_PBF:-${DATA_DIR}/source/java-latest.osm.pbf}"
geocoding_output="${DATA_DIR}/openstreetmap/gathra-supported-region.osm.pbf"
routing_output="${DATA_DIR}/openstreetmap/gathra-supported-region-routing.osm.pbf"
polygon="${GEOCODING_DIR}/region/supported-region.geojson"

if [[ ! -f "${source_pbf}" ]]; then
  echo "OSM source not found: ${source_pbf}" >&2
  echo "Run download-data.sh or set GATHRA_GEOCODING_SOURCE_PBF." >&2
  exit 2
fi
if [[ -f "${geocoding_output}" && "${force}" != true ]]; then
  echo "Extract already exists: ${geocoding_output}" >&2
  echo "Use --force only for an intentional source/config refresh." >&2
  exit 2
fi

tmp_dir="$(mktemp -d "${DATA_DIR}/openstreetmap/.extract.XXXXXX")"
cleanup() {
  rm -rf -- "${tmp_dir}"
}
trap cleanup EXIT

run_host_osmium() {
  osmium extract \
    --polygon "${polygon}" \
    --strategy complete_ways \
    --set-bounds \
    "${source_pbf}" \
    --output "${tmp_dir}/gathra-supported-region.osm.pbf"
  osmium check-refs "${tmp_dir}/gathra-supported-region.osm.pbf"
  osmium tags-filter \
    "${tmp_dir}/gathra-supported-region.osm.pbf" \
    nw/highway r/type=restriction \
    --output "${tmp_dir}/gathra-supported-region-routing.osm.pbf"
  osmium check-refs "${tmp_dir}/gathra-supported-region-routing.osm.pbf"
}

run_container_osmium() {
  local image="${GATHRA_OSMIUM_IMAGE:-gathra-osmium:1.19.1}"
  if ! docker image inspect "${image}" >/dev/null 2>&1; then
    echo "Neither host osmium nor fallback image ${image} is available." >&2
    echo "Install osmium-tool on Fedora or provide GATHRA_OSMIUM_IMAGE." >&2
    exit 2
  fi
  docker run --rm \
    -v "$(dirname -- "${source_pbf}"):/input:ro" \
    -v "${GEOCODING_DIR}/region:/region:ro" \
    -v "${tmp_dir}:/output" \
    "${image}" /bin/bash -lc \
    "osmium extract --polygon /region/supported-region.geojson --strategy complete_ways --set-bounds /input/$(basename -- "${source_pbf}") --output /output/gathra-supported-region.osm.pbf &&
     osmium check-refs /output/gathra-supported-region.osm.pbf &&
     osmium tags-filter /output/gathra-supported-region.osm.pbf nw/highway r/type=restriction --output /output/gathra-supported-region-routing.osm.pbf &&
     osmium check-refs /output/gathra-supported-region-routing.osm.pbf"
}

if command -v osmium >/dev/null 2>&1; then
  run_host_osmium
else
  run_container_osmium
fi

mv -f -- "${tmp_dir}/gathra-supported-region.osm.pbf" "${geocoding_output}"
mv -f -- "${tmp_dir}/gathra-supported-region-routing.osm.pbf" "${routing_output}"
sha256sum "${geocoding_output}" > "${geocoding_output}.sha256"
sha256sum "${routing_output}" > "${routing_output}.sha256"

jq -n \
  --arg regionVersion "$(jq -r '.version' "${REGION_CONFIG}")" \
  --arg source "$(basename -- "${source_pbf}")" \
  --arg sourceSha256 "$(sha256sum "${source_pbf}" | awk '{print $1}')" \
  --arg generatedAt "$(date --utc +%FT%TZ)" \
  '{
    regionVersion: $regionVersion,
    source: $source,
    sourceSha256: $sourceSha256,
    generatedAt: $generatedAt
  }' > "${DATA_DIR}/openstreetmap/extract-manifest.json"

echo "Prepared raw Pelias and routing-filtered extracts:"
cat "${geocoding_output}.sha256"
cat "${routing_output}.sha256"

