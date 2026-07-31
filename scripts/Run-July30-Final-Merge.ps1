[CmdletBinding()]
param(
    [string]$BackupRoot = 'D:\Kalpavriksha-Recovery-Backups\20260731-023830',
    [switch]$PublishOnly
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
    Write-Host "Recreating the verified deployment checkout at $GitAudit..." -ForegroundColor Cyan
    if (Test-Path -LiteralPath $GitAudit) {
        $existingItems = @(Get-ChildItem -LiteralPath $GitAudit -Force -ErrorAction SilentlyContinue)
        if ($existingItems.Count -gt 0) {
            throw "Deployment checkout path exists but is not a Git checkout: $GitAudit"
        }
    }
    Invoke-Native -FilePath git -ArgumentList @(
        'clone',
        '--branch', $ReleaseBranch,
        '--single-branch',
        'https://github.com/Kalpvriksha555/kalpavriksha-ops.git',
        $GitAudit
    )
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

if ($PublishOnly) {
    $certificatePath = Join-Path $BackupRoot 'final-release-certification.json'
    $reportPath = Join-Path $BackupRoot 'july30-final-report.json'
    if (-not (Test-Path -LiteralPath $certificatePath) -or -not (Test-Path -LiteralPath $reportPath)) {
        throw "Publish-only mode requires the downloaded final certificate and merge report in $BackupRoot"
    }
    $certificate = Get-Content -Raw -LiteralPath $certificatePath | ConvertFrom-Json
    $report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
    if ($certificate.status -ne 'CERTIFIED' -or -not $report.ok -or $report.mode -ne 'apply' -or -not $report.verification.postWriteVerified) {
        throw 'Downloaded evidence does not certify a completed and post-write-verified final merge.'
    }
    $certifiedCommit = [string]$certificate.gitCommit
    if (-not $certifiedCommit -or $certifiedCommit -ne $releaseCommit) {
        throw "Certified commit $certifiedCommit does not match the published release commit $releaseCommit"
    }
    Write-Host "Resuming publication of certified commit $certifiedCommit without repeating the database merge..." -ForegroundColor Cyan
} else {
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
}

Write-Host 'Fast-forwarding the verified final release into GitHub main...' -ForegroundColor Cyan
Push-Location $GitAudit
try {
    Invoke-Native -FilePath git -ArgumentList @('fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    Invoke-Native -FilePath git -ArgumentList @('switch', '-C', 'main', 'origin/main')
    Invoke-Native -FilePath git -ArgumentList @('merge', '--ff-only', $releaseCommit)
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
