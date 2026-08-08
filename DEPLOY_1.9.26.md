> **Superseded:** use `DEPLOY_1.9.27.md` and `bash scripts/launch-deploy-1.9.27-vps.sh`.

# Deploy Kalpavriksha 1.9.26

Release: `1.9.26-deployment-concurrency-backup-closure`  
Backend/frontend: `2.9.26-deployment-concurrency-backup-closure`

This release supersedes 1.9.25 for deployment. Do not run the 1.9.25 deployment script again.

## VPS deployment

Upload the ZIP to the VPS, extract it outside the live directory, and use the SSH-independent launcher:

```bash
rm -rf /var/www/kalpavriksha-release-1.9.26
mkdir -p /var/www/kalpavriksha-release-1.9.26
unzip -q /root/Kalpavriksha_1.9.26_Deployment_Concurrency_Backup_Closure.zip \
  -d /var/www/kalpavriksha-release-1.9.26
cd /var/www/kalpavriksha-release-1.9.26
bash scripts/launch-deploy-1.9.26-vps.sh
```

The launcher prints a systemd unit name. The deployment continues even if SSH disconnects.

Follow it with:

```bash
journalctl -fu "$(cat /root/kalpavriksha-deploy-last-unit)"
```

After reconnecting:

```bash
UNIT="$(cat /root/kalpavriksha-deploy-last-unit)"
systemctl status "$UNIT" --no-pager -l
journalctl -u "$UNIT" --no-pager -n 250 -l
```

Do not start another deployment while one is running. If the launcher is accidentally invoked again, the exclusive deployment lock prevents a second cutover from running.

Successful completion prints:

```text
KALPAVRIKSHA 1.9.26 DEPLOYMENT COMPLETED SUCCESSFULLY
```
