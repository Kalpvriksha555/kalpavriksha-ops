[CmdletBinding()]
param(
    [string]$BackupRoot = 'D:\Kalpavriksha-Recovery-Backups\20260731-023830'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Remote = 'root@187.127.189.38'
$RemoteWork = '/root/kalpavriksha-july30-safe'
$ReleaseBranch = 'july30-safe-release'
$GitAudit = 'D:\kalpavriksha-july30-deploy-audit'
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

foreach ($command in @('git', 'ssh', 'scp')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command is missing: $command"
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $GitAudit '.git'))) {
    throw "Verified deployment checkout is missing: $GitAudit"
}
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null

Push-Location $GitAudit
try {
    Invoke-Native -FilePath git -ArgumentList @('fetch', 'origin', $ReleaseBranch)
    $releaseCommit = (& git rev-parse "origin/$ReleaseBranch").Trim()
    if ($LASTEXITCODE -ne 0 -or -not $releaseCommit) { throw 'Unable to resolve the final release commit.' }
} finally {
    Pop-Location
}

Write-Host 'Uploading the final merge controller...' -ForegroundColor Cyan
Invoke-Native -FilePath scp -ArgumentList @(
    $Controller,
    "${Remote}:$RemoteWork/deploy-july30-safe-vps.sh"
)
Invoke-Native -FilePath ssh -ArgumentList @(
    $Remote,
    "chmod 700 '$RemoteWork/deploy-july30-safe-vps.sh' && EXPECTED_COMMIT='$releaseCommit' bash '$RemoteWork/deploy-july30-safe-vps.sh' final-merge-deploy"
)

Write-Host 'Downloading final merge evidence and verified backups...' -ForegroundColor Cyan
Invoke-Native -FilePath scp -ArgumentList @(
    "${Remote}:$RemoteWork/pre-final-merge-backup.tar",
    "${Remote}:$RemoteWork/post-final-merge-backup.tar",
    "${Remote}:$RemoteWork/july30-final-preflight.json",
    "${Remote}:$RemoteWork/july30-final-plan.json",
    "${Remote}:$RemoteWork/july30-final-report.json",
    "${Remote}:$RemoteWork/final-release-certification.json",
    "${Remote}:$RemoteWork/live-health.json",
    "${Remote}:$RemoteWork/ready-health.json",
    $BackupRoot
)

Write-Host 'Fast-forwarding the verified final release into GitHub main...' -ForegroundColor Cyan
Push-Location $GitAudit
try {
    Invoke-Native -FilePath git -ArgumentList @('fetch', 'origin')
    Invoke-Native -FilePath git -ArgumentList @('switch', '-C', 'main', 'origin/main')
    Invoke-Native -FilePath git -ArgumentList @('merge', '--ff-only', "origin/$ReleaseBranch")
    $mainCommit = (& git rev-parse HEAD).Trim()
    if ($mainCommit -ne $releaseCommit) { throw 'Verified final release is not the main candidate.' }
    Invoke-Native -FilePath git -ArgumentList @('push', 'origin', 'main')
} finally {
    Pop-Location
}

Write-Host 'Aligning the normal VPS checkout and enabling durable backup timers...' -ForegroundColor Cyan
Invoke-Native -FilePath ssh -ArgumentList @(
    $Remote,
    "EXPECTED_COMMIT='$releaseCommit' bash '$RemoteWork/deploy-july30-safe-vps.sh' align-main"
)

Write-Host ''
Write-Host 'FINAL MERGE, VERIFIED DEPLOYMENT, GITHUB MAIN, AND BACKUP TIMERS COMPLETED' -ForegroundColor Green
Write-Host "Verified commit: $releaseCommit" -ForegroundColor Green
Write-Host "Evidence bundle: $BackupRoot" -ForegroundColor Green
