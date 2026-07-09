#!/usr/bin/env bash
set -euo pipefail
rm -rf node_modules/.vite frontend/node_modules/.vite dist frontend/dist
printf 'Local Vite/dist cache cleaned. Restart npm run dev.\n'
