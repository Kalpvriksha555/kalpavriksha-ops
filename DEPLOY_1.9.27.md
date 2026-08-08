# Deploy Kalpavriksha 1.9.27

Release: `1.9.27-permanent-source-parity-cutover`
Backend/frontend: `2.9.27-permanent-source-parity-cutover`

The production database must already pass strict relational integrity. This release does not restore or rewrite business rows.

## VPS deployment

Upload the certified ZIP to `/root/Kalpavriksha_1.9.27_Permanent_Source_Parity_Cutover.zip`, then:

```bash
rm -rf /var/www/kalpavriksha-release-1.9.27
mkdir -p /var/www/kalpavriksha-release-1.9.27
unzip -q /root/Kalpavriksha_1.9.27_Permanent_Source_Parity_Cutover.zip \
  -d /var/www/kalpavriksha-release-1.9.27
cd /var/www/kalpavriksha-release-1.9.27
chmod +x scripts/deploy-1.9.27-vps.sh scripts/launch-deploy-1.9.27-vps.sh
bash scripts/launch-deploy-1.9.27-vps.sh
```

The launcher records the detached systemd unit in `/root/kalpavriksha-deploy-last-unit`.

Follow it with:

```bash
UNIT="$(cat /root/kalpavriksha-deploy-last-unit)"
journalctl -fu "$UNIT"
```

If SSH disconnects, reconnect and run:

```bash
UNIT="$(cat /root/kalpavriksha-deploy-last-unit)"
systemctl status "$UNIT" --no-pager -l
journalctl -u "$UNIT" --no-pager -n 250 -l
```

Do not start a second deployment. The cross-release flock will reject it anyway.

Success marker:

```text
KALPAVRIKSHA 1.9.27 DEPLOYMENT COMPLETED SUCCESSFULLY
```
