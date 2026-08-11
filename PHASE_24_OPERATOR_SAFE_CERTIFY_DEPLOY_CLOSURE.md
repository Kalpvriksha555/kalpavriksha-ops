# Phase 24 — SSH-Independent Final Certification & Operator Deployment Closure

Date: 2026-08-11

Phase 24 was opened while moving the Phase 23 source candidate toward the real VPS gate. The active root operator document `PUSH_AND_DEPLOY.md` still instructed an operator to fetch and execute `scripts/deploy-1.9.24-vps.sh`, and `DEPLOY_1.9.30.md` still named the obsolete `runtime-persistence-recovery` release family. Following either document could bypass the current candidate-certification path or deploy the wrong historical entrypoint.

This phase removes that operator ambiguity and makes the whole final process resilient to SSH loss:

- the only supported normal starting point is `scripts/launch-certify-and-deploy-1.9.30-vps.sh` from a fresh non-live Git checkout;
- the launcher proves the checkout is clean and exactly equals GitHub `origin/main`;
- it starts the entire integrated certification + deployment workflow with `systemd-run`, not just the final production cutover;
- it records `/root/kalpavriksha-final-release-last-unit` for reconnect/status/log retrieval;
- the integrated orchestrator holds `/run/lock/kalpavriksha-final-certify-deploy.lock` for its complete lifetime, preventing two final certification/deployment pipelines from overlapping;
- current operator docs no longer reference the 1.9.24 deployer or obsolete current release names;
- project doctor and the permanent Phase 24 gate require the current wrapper/docs to remain packaged.

Current release identity: `1.9.30-ssh-independent-certify-deploy-closure`; backend/frontend `2.9.30-ssh-independent-certify-deploy-closure`.
