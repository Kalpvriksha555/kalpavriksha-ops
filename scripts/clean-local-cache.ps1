# PowerShell local cleanup for Kalpavriksha Ops
# Run from the project root.
$ErrorActionPreference = "SilentlyContinue"
Remove-Item -Recurse -Force "node_modules/.vite"
Remove-Item -Recurse -Force "frontend/node_modules/.vite"
Remove-Item -Recurse -Force "dist"
Remove-Item -Recurse -Force "frontend/dist"
Write-Host "Local Vite/dist cache cleaned. Restart npm run dev." -ForegroundColor Green
