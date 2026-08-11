# Deploy Kalpavriksha 1.9.30 — Current Supported Path

Release: `1.9.30-ssh-independent-certify-deploy-closure`  
Backend/frontend: `2.9.30-ssh-independent-certify-deploy-closure`

## Primary entrypoint

Production deployment is intentionally blocked until the exact GitHub commit passes isolated candidate certification. Run the final wrapper only from a **fresh Git checkout outside** `/var/www/kalpavriksha-ops`:

```bash
bash scripts/launch-certify-and-deploy-1.9.30-vps.sh

The launcher enqueues the full pipeline with non-blocking systemd handoff, disables the start-timeout race with `TimeoutStartSec=infinity`, records the exact new unit, and verifies that unit becomes active before reporting success.
```

The wrapper validates that the checkout is clean, is not the live path, and exactly equals GitHub `origin/main`. It then launches `scripts/certify-and-deploy-1.9.30-vps.sh` as an SSH-independent transient systemd unit and records that unit in:

```text
/root/kalpavriksha-final-release-last-unit
```

Follow it with:

```bash
journalctl -fu "$(cat /root/kalpavriksha-final-release-last-unit)"
```

The integrated orchestrator holds a full-lifecycle lock so two certification/deployment pipelines cannot overlap. It creates the disposable PostgreSQL certification cluster outside the live data directory on a distinct socket/port, certifies the exact candidate, deletes the disposable cluster before live mutation, then delegates production cutover to the Phase 21 resume-aware/atomic deployer.

## Internal/manual entrypoints

`scripts/candidate-certify-1.9.30-vps.sh`, `scripts/launch-deploy-1.9.30-vps.sh`, and `scripts/deploy-1.9.30-vps.sh` remain internal building blocks. They are not the normal operator starting point for a fresh final release.

Do not use the legacy 1.9.24–1.9.29 deployment instructions for this candidate.

A successful final run writes `/root/kalpavriksha-final-deployment.result.json` with status `DEPLOYED_AND_PUBLICLY_VERIFIED`.
