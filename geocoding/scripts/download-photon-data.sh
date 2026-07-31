#!/usr/bin/env bash
set -Eeuo pipefail

readonly DATA_URL="${PHOTON_DATA_URL:-https://download1.graphhopper.com/public/extracts/by-country-code/id/photon-db-id-250720.tar.bz2}"
readonly DATA_MD5="${PHOTON_DATA_MD5:-0e027552ff841b12a2c703cf290daad2}"
readonly DATA_VOLUME="${PHOTON_DATA_VOLUME:-gathra-routing_photon-data}"
readonly COPY_IMAGE="alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"

for command in curl docker md5sum tar; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command not found: ${command}" >&2
    exit 2
  fi
done

docker volume create "${DATA_VOLUME}" >/dev/null
existing="$(
  docker run --rm \
    -v "${DATA_VOLUME}:/data:ro" \
    "${COPY_IMAGE}" \
    sh -c 'find /data -mindepth 1 -maxdepth 1 -print -quit'
)"
if [[ -n "${existing}" ]]; then
  echo "Refusing to overwrite non-empty Photon volume: ${DATA_VOLUME}" >&2
  echo "Back up and replace it explicitly; this script is initial-install only." >&2
  exit 2
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "${tmp_dir}"
}
trap cleanup EXIT

archive="${tmp_dir}/photon-indonesia.tar.bz2"
candidate="${tmp_dir}/candidate"
mkdir -p "${candidate}"

echo "Downloading the pinned Indonesia Photon dump (about 452 MiB)..."
curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
  --output "${archive}" "${DATA_URL}"
echo "${DATA_MD5}  ${archive}" | md5sum --check -

if tar --list --bzip2 --file "${archive}" \
  | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Archive contains an unsafe path." >&2
  exit 2
fi

tar --extract --bzip2 --file "${archive}" \
  --directory "${candidate}" --strip-components=1
if [[ ! -d "${candidate}/elasticsearch" ]]; then
  echo "Archive does not contain the expected Photon index." >&2
  exit 2
fi

docker run --rm \
  -v "${DATA_VOLUME}:/target" \
  -v "${candidate}:/source:ro" \
  "${COPY_IMAGE}" \
  sh -c 'cp -a /source/. /target/'

echo "Photon data installed in ${DATA_VOLUME}."
