#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

RELEASE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_ROOT="${KALPA_LIVE_ROOT:-/var/www/kalpavriksha-ops}"
ORCHESTRATOR="$RELEASE_ROOT/scripts/certify-and-deploy-1.9.30-vps.sh"
UNIT_PREFIX="kalpavriksha-final-1930"
UNIT="${UNIT_PREFIX}-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}"
LAST_UNIT_FILE="${KALPA_FINAL_RELEASE_LAST_UNIT_FILE:-/root/kalpavriksha-final-release-last-unit}"

fail(){ printf 'FINAL RELEASE LAUNCH STOPPED SAFELY: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" == "0" ]] || fail "Run as root on the VPS."
[[ -d "$RELEASE_ROOT/.git" ]] || fail "Run only from a clean Git candidate checkout."
[[ "$(realpath -m "$RELEASE_ROOT")" != "$(realpath -m "$LIVE_ROOT")" ]] || fail "Never launch final certification from the live source path."
[[ -f "$ORCHESTRATOR" ]] || fail "Integrated certification/deployment script is missing: $ORCHESTRATOR"
bash -n "$ORCHESTRATOR" || fail "Integrated certification/deployment script failed Bash syntax validation."
for tool in git systemd-run systemctl realpath sleep; do command -v "$tool" >/dev/null 2>&1 || fail "Required command is missing: $tool"; done

CURRENT_COMMIT="$(git -C "$RELEASE_ROOT" rev-parse HEAD 2>/dev/null || true)"
[[ -n "$CURRENT_COMMIT" ]] || fail "Candidate checkout has no Git commit identity."
[[ -z "$(git -C "$RELEASE_ROOT" -c core.fileMode=false status --porcelain --untracked-files=no)" ]] || fail "Tracked candidate source is dirty. Commit/push it before certification."
REMOTE_COMMIT="$(git -C "$RELEASE_ROOT" ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
[[ -n "$REMOTE_COMMIT" ]] || fail "Could not resolve GitHub origin/main."
[[ "$REMOTE_COMMIT" == "$CURRENT_COMMIT" ]] || fail "Candidate commit $CURRENT_COMMIT is not current GitHub main $REMOTE_COMMIT."

# Do not launch a second wrapper while a previous final wrapper is still active.
if [[ -s "$LAST_UNIT_FILE" ]]; then
  PREVIOUS_UNIT="$(tr -d '[:space:]' < "$LAST_UNIT_FILE")"
  if [[ -n "$PREVIOUS_UNIT" ]] && systemctl is-active --quiet "$PREVIOUS_UNIT" 2>/dev/null; then
    printf 'A final Kalpavriksha certification/deployment unit is already running: %s\n' "$PREVIOUS_UNIT"
    printf 'Follow: journalctl -fu %q\n' "$PREVIOUS_UNIT"
    exit 75
  fi
fi

systemd-run \
  --no-block \
  --unit="$UNIT" \
  --property=Type=exec \
  --property=TimeoutStartSec=infinity \
  --property=TimeoutStopSec=300 \
  --property=KillMode=control-group \
  --property=Restart=no \
  --working-directory="$RELEASE_ROOT" \
  /bin/bash "$ORCHESTRATOR"

UNIT_SERVICE="${UNIT}.service"
LAST_UNIT_TMP="${LAST_UNIT_FILE}.tmp.$$"
printf '%s\n' "$UNIT_SERVICE" > "$LAST_UNIT_TMP"
mv -f "$LAST_UNIT_TMP" "$LAST_UNIT_FILE"

# systemd-run --no-block only confirms enqueue. Prove the transient unit actually
# reached the active state so an immediate exec/start failure is never reported
# to the operator as a successful SSH-independent handoff.
UNIT_STARTED=0
for _ in {1..40}; do
  ACTIVE_STATE="$(systemctl show "$UNIT_SERVICE" -p ActiveState --value 2>/dev/null || true)"
  if [[ "$ACTIVE_STATE" == "active" ]]; then
    UNIT_STARTED=1
    break
  fi
  if [[ "$ACTIVE_STATE" == "failed" || "$ACTIVE_STATE" == "inactive" ]]; then
    RESULT="$(systemctl show "$UNIT_SERVICE" -p Result --value 2>/dev/null || true)"
    fail "Transient final-release unit failed during handoff (unit=$UNIT_SERVICE active=$ACTIVE_STATE result=${RESULT:-unknown})."
  fi
  sleep 0.25
done
[[ "$UNIT_STARTED" == "1" ]] || fail "Transient final-release unit did not become active within 10 seconds: $UNIT_SERVICE"

printf '\nKalpavriksha final certification + deployment started independently of SSH.\n'
printf 'Candidate commit: %s\n' "$CURRENT_COMMIT"
printf 'Unit: %s\n' "$UNIT_SERVICE"
printf 'Follow now: journalctl -fu %s\n' "$UNIT_SERVICE"
printf 'After reconnect: journalctl -u "$(cat %s)" --no-pager -n 350 -l\n' "$LAST_UNIT_FILE"
printf 'Status: systemctl status "$(cat %s)" --no-pager -l\n' "$LAST_UNIT_FILE"
