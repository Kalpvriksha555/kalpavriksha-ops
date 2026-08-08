# Deploy Kalpavriksha 1.9.29

Extract the certified ZIP outside `/var/www/kalpavriksha-ops`, then run:

```bash
cd /var/www/kalpavriksha-release-1.9.29
bash scripts/launch-deploy-1.9.29-vps.sh
```

The launcher detaches through systemd and the cross-release flock prevents a second concurrent deployment. Do not start another deployment if SSH disconnects; follow the unit stored in `/root/kalpavriksha-deploy-last-unit`.

The final production gate validates PostgreSQL through `npm run db:integrity --prefix backend` and runtime health through the public `/api/health/live` and `/api/health/ready` endpoints. The admin-protected `/api/db/health` endpoint is intentionally not used as an anonymous deployment probe.
