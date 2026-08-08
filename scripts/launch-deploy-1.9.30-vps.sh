#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

RELEASE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_SCRIPT="$RELEASE_ROOT/scripts/deploy-1.9.30-vps.sh"
UNIT_PREFIX="kalpavriksha-deploy-1930"
UNIT="${UNIT_PREFIX}-$(date -u +%Y%m%dT%H%M%SZ)"
LAST_UNIT_FILE="${KALPA_DEPLOY_LAST_UNIT_FILE:-/root/kalpavriksha-deploy-last-unit}"

[[ -x "$DEPLOY_SCRIPT" ]] || { echo "Deployment script is missing or not executable: $DEPLOY_SCRIPT" >&2; exit 1; }
command -v systemd-run >/dev/null || { echo "systemd-run is required for SSH-independent deployment." >&2; exit 1; }

if command -v flock >/dev/null 2>&1; then
  exec 7>>"${KALPA_DEPLOY_LOCK:-/run/lock/kalpavriksha-production-deploy.lock}"
  if ! flock -n 7; then
    echo "A Kalpavriksha deployment is already running. Nothing new was started."
    exit 75
  fi
  flock -u 7
fi

printf '%s.service\n' "$UNIT" > "$LAST_UNIT_FILE"

systemd-run \
  --unit="$UNIT" \
  --property=Type=simple \
  --property=TimeoutStartSec=0 \
  /bin/bash "$DEPLOY_SCRIPT"

echo
echo "Kalpavriksha 1.9.30 deployment started independently of SSH."
echo "Unit: $UNIT.service"
echo "Follow: journalctl -fu $UNIT.service"
echo "Reconnect: journalctl -u \"\$(cat $LAST_UNIT_FILE)\" --no-pager -n 250 -l"
