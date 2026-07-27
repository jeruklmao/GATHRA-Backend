#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "$0")/_common.sh"

require_command jq
manifest="${DATA_DIR}/rollback/last-switch.json"
target="${1:-}"

if [[ -z "${target}" ]]; then
  if [[ ! -f "${manifest}" ]]; then
    echo "No rollback manifest found and no target index supplied." >&2
    exit 2
  fi
  target="$(jq -r '.from[0] // empty' "${manifest}")"
fi

if [[ -z "${target}" ]]; then
  echo "Rollback manifest has no previous index." >&2
  exit 2
fi

"${SCRIPT_DIR}/switch-index-alias.sh" "${target}"

