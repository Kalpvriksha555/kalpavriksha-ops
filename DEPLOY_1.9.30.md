# Deploy Kalpavriksha 1.9.30

Release: `1.9.30-runtime-persistence-recovery`
Backend/frontend: `2.9.30-runtime-persistence-recovery`

Production deployment is intentionally blocked until the exact GitHub commit passes isolated VPS candidate certification. Clone the candidate outside `/var/www/kalpavriksha-ops`, then run:

```bash
cd /var/www/kalpavriksha-candidate-1.9.30
chmod +x scripts/candidate-certify-1.9.30-vps.sh scripts/deploy-1.9.30-vps.sh scripts/launch-deploy-1.9.30-vps.sh
bash scripts/candidate-certify-1.9.30-vps.sh
```

The candidate gate installs real dependencies, runs the React/Vite bootstrap and full production build, then restores a read-only snapshot of production into a disposable PostgreSQL database. It performs a real case-create/collision/idempotent-replay/4 MiB upload/download workflow against the disposable clone and records the exact certified commit. It does not modify the live database, live private files, frontend, source tree, or PM2 process.

Only after the candidate ends with `KALPAVRIKSHA CANDIDATE CERTIFIED`, launch that same checkout:

```bash
bash scripts/launch-deploy-1.9.30-vps.sh
```

The launcher itself verifies the current commit and GitHub `main` still exactly match the certification receipt and refuses to deploy any other commit.

The launcher detaches through `systemd-run`, records the unit in `/root/kalpavriksha-deploy-last-unit`, and uses the cross-release deployment lock so a second deployment cannot overlap it. Follow progress with:

```bash
journalctl -fu "$(cat /root/kalpavriksha-deploy-last-unit)"
```

The deployment fails closed before cutover if the exact release version, clean dependency install, complete verification suite, signed-out React runtime bootstrap, production frontend build, production environment, PostgreSQL integrity, release certificate, staged liveness/readiness, or verified backup gates fail. It captures the previous runtime/source/environment/frontend/certificate for rollback before live mutation. It never treats a failed gate as permission to overwrite production business data.

A successful run ends with:

```text
KALPAVRIKSHA 1.9.30 DEPLOYMENT COMPLETED SUCCESSFULLY
```
