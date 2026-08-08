# Push and Deploy

## Push from the local Git repository

Extract this ZIP over the existing repository while preserving `.git`, then run:

```powershell
git status
git add -A
git commit -m "Clean release and guarded production integrity repair"
git push origin main
```

## Deploy on the VPS

Do not reset the live checkout before the deployment script snapshots the current runtime.

```bash
set -Eeuo pipefail
cd /var/www/kalpavriksha-ops
git fetch origin main
git show origin/main:scripts/deploy-1.9.24-vps.sh > /root/deploy-1.9.24-vps.sh
chmod +x /root/deploy-1.9.24-vps.sh
bash /root/deploy-1.9.24-vps.sh
```

The deployment must finish with:

```text
KALPVRIKSHA VERSION 1.9.24 DEPLOYMENT COMPLETED SUCCESSFULLY
```
