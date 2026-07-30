# Phase 9 build-tooling isolation fix

The production staging environment sets `NODE_ENV=production`. npm therefore omitted frontend `devDependencies`, including Tailwind CSS and PostCSS, even though those packages are required to compile the frontend.

The clean-install verifier and deployment procedure now explicitly install build-time development dependencies with `--include=dev`. Runtime deployment can still install backend production dependencies only.
