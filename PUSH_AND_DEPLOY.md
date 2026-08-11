# Push and Deploy — Current 1.9.30 Final Path

Current source candidate: `1.9.30-ssh-independent-certify-deploy-closure`  
Backend/frontend: `2.9.30-ssh-independent-certify-deploy-closure`

> **Do not deploy from `/var/www/kalpavriksha-ops` and do not run any older `deploy-1.9.24` through `deploy-1.9.29` launcher.** The only supported final entrypoint is `scripts/launch-certify-and-deploy-1.9.30-vps.sh` from a fresh non-live Git checkout.

## 1. Push this ZIP from the existing Windows Git repository

Extract this ZIP **over the existing project repository while preserving its `.git` directory**, then run from PowerShell in that repository:

```powershell
git status
git add -A
git commit -m "Phase 24 SSH-independent final certification and deployment closure"
git push origin main
git rev-parse HEAD
```

Keep the commit printed by `git rev-parse HEAD`. The VPS launcher independently proves that the candidate checkout is this exact `origin/main` commit before any certification starts.

## 2. On the VPS, create a fresh candidate checkout without touching live source

Run as root:

```bash
set -Eeuo pipefail
LIVE=/var/www/kalpavriksha-ops
REPO_URL="$(git -C "$LIVE" remote get-url origin)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CANDIDATE="/var/www/kalpavriksha-candidate-1.9.30-$STAMP"
git clone --branch main --single-branch "$REPO_URL" "$CANDIDATE"
cd "$CANDIDATE"
git rev-parse HEAD
bash scripts/launch-certify-and-deploy-1.9.30-vps.sh
```

This launches the **entire candidate certification + guarded deployment pipeline as a transient systemd unit**, so an SSH disconnect does not interrupt npm installation, the temporary PostgreSQL clone, database export/restore, candidate E2E certification, or the later production deployment.

## 3. Follow progress

```bash
journalctl -fu "$(cat /root/kalpavriksha-final-release-last-unit)"
```

After reconnecting:

```bash
systemctl status "$(cat /root/kalpavriksha-final-release-last-unit)" --no-pager -l
journalctl -u "$(cat /root/kalpavriksha-final-release-last-unit)" --no-pager -n 350 -l
```

Do **not** start another run while this unit is active. The integrated orchestrator also holds `/run/lock/kalpavriksha-final-certify-deploy.lock` for the complete certification/deployment lifecycle.

## Success evidence

The final wrapper must finish successfully and the integrated process must write:

```text
/root/kalpavriksha-final-deployment.result.json
```

The final logs must show the exact current commit, successful isolated candidate certification, removal of temporary PostgreSQL before live deployment, successful guarded deployment, permanent PM2 path, local live/readiness checks, public API health, and public frontend reachability.

A failed source/build/database/candidate/deployment gate is **not permission to modify or restore production business data manually**. The deployment scripts own code/frontend rollback; database restoration remains an explicit operator-controlled recovery action.
