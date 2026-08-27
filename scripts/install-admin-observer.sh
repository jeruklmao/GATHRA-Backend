#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi
release=${1:-/opt/gathra/current}
release=$(readlink -f -- "$release")
case "$release" in
  /opt/gathra/releases/*) ;;
  *) echo "Release must resolve below /opt/gathra/releases." >&2; exit 1 ;;
esac
observer="$release/ops/admin-observer/gathra_admin_observer.py"
unit="$release/ops/systemd/gathra-admin-observer.service"
[[ -f "$observer" && -f "$unit" ]] || {
  echo "The selected release does not contain observer files." >&2
  exit 1
}
install -o root -g root -m 0755 "$observer" \
  /opt/gathra-deploy/scripts/gathra-admin-observer.py
install -o root -g root -m 0644 "$unit" \
  /etc/systemd/system/gathra-admin-observer.service
systemctl daemon-reload
systemctl enable --now gathra-admin-observer.service
