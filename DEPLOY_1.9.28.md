# Deploy Kalpavriksha 1.9.28

Extract the certified ZIP outside `/var/www/kalpavriksha-ops`, then run:

```bash
cd /var/www/kalpavriksha-release-1.9.28
bash scripts/launch-deploy-1.9.28-vps.sh
```

The launcher detaches through systemd. Do not start a second deployment. Follow the unit written to `/root/kalpavriksha-deploy-last-unit`.
