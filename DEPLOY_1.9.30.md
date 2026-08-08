# Deploy Kalpavriksha 1.9.30

Release: `1.9.30-runtime-persistence-recovery`
Backend/frontend: `2.9.30-runtime-persistence-recovery`

Extract the complete release ZIP outside `/var/www/kalpavriksha-ops`, then run:

```bash
cd /var/www/kalpavriksha-release-1.9.30
chmod +x scripts/deploy-1.9.30-vps.sh scripts/launch-deploy-1.9.30-vps.sh
bash scripts/launch-deploy-1.9.30-vps.sh
```

The launcher detaches through `systemd-run`, records the unit in `/root/kalpavriksha-deploy-last-unit`, and uses the cross-release deployment lock so a second deployment cannot overlap it. Follow progress with:

```bash
journalctl -fu "$(cat /root/kalpavriksha-deploy-last-unit)"
```

The deployment fails closed before cutover if the exact release version, clean dependency install, complete verification suite, signed-out React runtime bootstrap, production frontend build, production environment, PostgreSQL integrity, release certificate, staged liveness/readiness, or verified backup gates fail. It captures the previous runtime/source/environment/frontend/certificate for rollback before live mutation. It never treats a failed gate as permission to overwrite production business data.

A successful run ends with:

```text
KALPAVRIKSHA 1.9.30 DEPLOYMENT COMPLETED SUCCESSFULLY
```
