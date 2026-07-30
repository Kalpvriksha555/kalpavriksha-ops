[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Remote = 'root@187.127.189.38'
$RemoteWork = '/root/kalpavriksha-july30-safe'
$Controller = Join-Path $ProjectRoot 'scripts\deploy-july30-safe-vps.sh'

function Invoke-Native {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$ArgumentList
    )
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

foreach ($command in @('ssh', 'scp')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command is missing: $command"
    }
}
if (-not (Test-Path -LiteralPath $Controller)) {
    throw "Stable restore controller is missing: $Controller"
}

Write-Host 'Uploading the restore-only controller. No recovery or GitHub main change will run.' -ForegroundColor Cyan
Invoke-Native -FilePath scp -ArgumentList @(
    $Controller,
    "${Remote}:$RemoteWork/deploy-july30-safe-vps.sh"
)

Write-Host 'Restoring and health-checking the known stable backend...' -ForegroundColor Cyan
Invoke-Native -FilePath ssh -ArgumentList @(
    $Remote,
    "chmod 700 '$RemoteWork/deploy-july30-safe-vps.sh' && bash '$RemoteWork/deploy-july30-safe-vps.sh' restore-stable"
)

Write-Host ''
Write-Host 'WEBSITE RESTORED TO THE STABLE BACKEND; JULY 30 RECOVERY IS PRESERVED AND DEFERRED' -ForegroundColor Green
