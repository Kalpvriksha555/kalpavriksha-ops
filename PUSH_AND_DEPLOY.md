# Push and Deploy — Current 1.9.30 Release

## Push from the local Git repository

Extract this complete ZIP over the existing local repository while preserving `.git`, then run:

```powershell
git status
git add -A
git commit -m "Close case creation and file upload runtime integrity"
git push origin main
```

## Deploy on the VPS

Do **not** run the deployment from `/var/www/kalpavriksha-ops`. Extract the release to a separate directory so the guarded deployer can snapshot and roll back the live tree safely.

```bash
set -Eeuo pipefail
REL=/var/www/kalpavriksha-release-1.9.30
rm -rf "$REL"
mkdir -p "$REL"
unzip -q /root/Kalpavriksha_1.9.30_Full_Case_Upload_Repair_2026-08-08.zip -d "$REL"
cd "$REL"
chmod +x scripts/deploy-1.9.30-vps.sh scripts/launch-deploy-1.9.30-vps.sh
bash scripts/launch-deploy-1.9.30-vps.sh
```

Follow the SSH-independent deployment with:

```bash
journalctl -fu "$(cat /root/kalpavriksha-deploy-last-unit)"
```

Only treat deployment as successful when the log ends with:

```text
KALPAVRIKSHA 1.9.30 DEPLOYMENT COMPLETED SUCCESSFULLY
```

The deployer performs clean dependency installation, the complete verification suite, a verified pre-deployment backup, migrations/integrity checks, release certification, staged health checks, source-parity cutover, permanent health checks, final integrity validation, and a verified post-deployment backup. Any failed mandatory gate aborts or rolls back rather than silently continuing.
