#!/usr/bin/env bash
set -euo pipefail

if [[ ! -t 0 || ! -t 1 ]]; then
  echo "This helper requires an interactive terminal." >&2
  exit 1
fi
if [[ ${EUID} -ne 0 ]]; then
  echo "Run this helper with sudo." >&2
  exit 1
fi

target=/opt/gathra-deploy/admin-auth.env
derive=/opt/gathra-deploy/scripts/derive-admin-password.mjs
umask 077
read -r -s -p "New password for admin (minimum 12 characters): " password
echo
read -r -s -p "Confirm password: " confirmation
echo
if [[ "$password" != "$confirmation" ]]; then
  unset password confirmation
  echo "Passwords do not match." >&2
  exit 1
fi
if (( ${#password} < 12 )); then
  unset password confirmation
  echo "Password must contain at least 12 characters." >&2
  exit 1
fi

verifier=$(printf '%s' "$password" | /usr/bin/node "$derive")
unset password confirmation
session_secret=
if [[ -f "$target" ]]; then
  session_secret=$(sed -n 's/^ADMIN_SESSION_SECRET=//p' "$target" | head -n 1)
fi
if [[ ! "$session_secret" =~ ^[A-Za-z0-9_-]{43}$ ]]; then
  session_secret=$(/usr/bin/node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")
fi

temporary=$(mktemp /opt/gathra-deploy/.admin-auth.env.XXXXXX)
trap 'rm -f "$temporary"' EXIT
{
  printf 'ADMIN_USERNAME=admin\n'
  printf 'ADMIN_PASSWORD_VERIFIER=%s\n' "$verifier"
  printf 'ADMIN_SESSION_SECRET=%s\n' "$session_secret"
} > "$temporary"
chown fadhli:fadhli "$temporary"
chmod 0600 "$temporary"
mv -f "$temporary" "$target"
trap - EXIT
unset verifier session_secret
echo "Admin password configuration written securely to $target."
