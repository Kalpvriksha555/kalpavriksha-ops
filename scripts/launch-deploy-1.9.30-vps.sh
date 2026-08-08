#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

RELEASE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_SCRIPT="$RELEASE_ROOT/scripts/deploy-1.9.30-vps.sh"
UNIT_PREFIX="kalpavriksha-deploy-1930"
UNIT="${UNIT_PREFIX}-$(date -u +%Y%m%dT%H%M%SZ)"
LAST_UNIT_FILE="${KALPA_DEPLOY_LAST_UNIT_FILE:-/root/kalpavriksha-deploy-last-unit}"
CERTIFIED_COMMIT_FILE="${KALPA_CERTIFIED_COMMIT_FILE:-/root/kalpavriksha-certified-candidate.commit}"
CERTIFIED_RESULT_FILE="${KALPA_CERTIFIED_RESULT_FILE:-/root/kalpavriksha-certified-candidate.result.json}"

[[ -f "$DEPLOY_SCRIPT" ]] || { echo "Deployment script is missing: $DEPLOY_SCRIPT" >&2; exit 1; }
bash -n "$DEPLOY_SCRIPT" || { echo "Deployment script failed Bash syntax validation: $DEPLOY_SCRIPT" >&2; exit 1; }
command -v systemd-run >/dev/null || { echo "systemd-run is required for SSH-independent deployment." >&2; exit 1; }
command -v git >/dev/null || { echo "git is required to prove the certified candidate commit." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required to verify the candidate certification receipt." >&2; exit 1; }

[[ -s "$CERTIFIED_COMMIT_FILE" ]] || { echo "No isolated candidate certification exists. Run scripts/candidate-certify-1.9.30-vps.sh successfully before production deployment." >&2; exit 1; }
[[ -s "$CERTIFIED_RESULT_FILE" ]] || { echo "Candidate certification receipt is missing: $CERTIFIED_RESULT_FILE" >&2; exit 1; }
CURRENT_COMMIT="$(git -C "$RELEASE_ROOT" rev-parse HEAD 2>/dev/null || true)"
CERTIFIED_COMMIT="$(tr -d '[:space:]' < "$CERTIFIED_COMMIT_FILE")"
[[ -n "$CURRENT_COMMIT" ]] || { echo "Release root is not a Git commit. Deploy only the exact GitHub commit that passed isolated candidate certification." >&2; exit 1; }
[[ "$CURRENT_COMMIT" == "$CERTIFIED_COMMIT" ]] || { echo "Release commit $CURRENT_COMMIT is not the certified candidate $CERTIFIED_COMMIT. Refusing production deployment." >&2; exit 1; }
python3 - "$CERTIFIED_RESULT_FILE" "$CURRENT_COMMIT" <<'PY'
import json,sys
path,commit=sys.argv[1:3]
try:
    data=json.load(open(path))
except Exception as exc:
    raise SystemExit(f'Candidate certification receipt is unreadable: {exc}')
if data.get('ok') is not True or data.get('status') != 'CERTIFIED_FOR_GUARDED_DEPLOYMENT' or str(data.get('commit') or '') != commit:
    raise SystemExit('Candidate certification receipt does not authorize this exact commit.')
checks=data.get('e2e') or {}
for key in ('downloadHashMatched','staleOptimisticIdResolvedToCanonicalTask','wrongTaskAttachmentPrevented'):
    if checks.get(key) is not True:
        raise SystemExit(f'Candidate certification receipt is missing required E2E proof: {key}')
PY
REMOTE_COMMIT="$(git -C "$RELEASE_ROOT" ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
[[ -n "$REMOTE_COMMIT" && "$REMOTE_COMMIT" == "$CURRENT_COMMIT" ]] || { echo "GitHub main moved after candidate certification. Re-certify before deployment." >&2; exit 1; }

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
