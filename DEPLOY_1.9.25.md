> **Superseded:** use `DEPLOY_1.9.27.md` and `bash scripts/launch-deploy-1.9.27-vps.sh`.

# Kalpavriksha 1.9.25 Deployment — Superseded

The 1.9.25 deployment entrypoint is intentionally disabled in the 1.9.26 package.

Use `DEPLOY_1.9.26.md` and run:

```bash
bash scripts/launch-deploy-1.9.26-vps.sh
```

This prevents accidental reuse of the deployment path that lacked exclusive deployment locking and deterministic private-file snapshot backup.
