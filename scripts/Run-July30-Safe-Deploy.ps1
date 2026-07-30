[CmdletBinding()]
param(
    [string]$RecoveryExport = "$env:USERPROFILE\Downloads\kalpvriksha-finance-recovery-1785402249604.json",
    [string]$BackupRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Remote = 'root@187.127.189.38'
$RemoteWork = '/root/kalpavriksha-july30-safe'
$ReleaseBranch = 'july30-safe-release'
$GitUrl = 'https://github.com/Kalpvriksha555/kalpavriksha-ops.git'
$GitAudit = 'D:\kalpavriksha-july30-deploy-audit'
$BackupBase = 'D:\Kalpavriksha-Recovery-Backups'
$ExpectedFileSha256 = '51DB407B8F1BF7BAEECDDD37CAEDF5C503EA2F7716B8BFF270F0BF669AB455DA'

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

function Backup-BrowserStorage {
    param([Parameter(Mandatory)][string]$Destination)
    $roots = @(
        @{ Name = 'Chrome'; Path = "$env:LOCALAPPDATA\Google\Chrome\User Data" },
        @{ Name = 'Edge'; Path = "$env:LOCALAPPDATA\Microsoft\Edge\User Data" }
    )
    foreach ($browser in $roots) {
        if (-not (Test-Path -LiteralPath $browser.Path)) { continue }
        $profiles = Get-ChildItem -LiteralPath $browser.Path -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' }
        foreach ($profile in $profiles) {
            foreach ($relative in @('Local Storage\leveldb', 'IndexedDB')) {
                $source = Join-Path $profile.FullName $relative
                if (-not (Test-Path -LiteralPath $source)) { continue }
                $target = Join-Path $Destination (Join-Path $browser.Name (Join-Path $profile.Name $relative))
                New-Item -ItemType Directory -Path $target -Force | Out-Null
                & robocopy $source $target /E /R:1 /W:1 /COPY:DAT /DCOPY:DAT /XJ | Out-Host
                if ($LASTEXITCODE -gt 7) {
                    throw "Browser storage backup failed for $source (robocopy $LASTEXITCODE)"
                }
            }
        }
    }
}

foreach ($command in @('git', 'node', 'npm', 'ssh', 'scp', 'robocopy')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command is missing: $command"
    }
}
if (-not (Test-Path -LiteralPath $RecoveryExport)) {
    throw "July 30 recovery export is missing: $RecoveryExport"
}
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $RecoveryExport).Hash
if ($actualHash -ne $ExpectedFileSha256) {
    throw "Recovery export SHA-256 mismatch. Expected $ExpectedFileSha256 but found $actualHash"
}

if ($BackupRoot) {
    $LocalBackupRoot = $BackupRoot
} else {
    $reusableBackup = Get-ChildItem -LiteralPath $BackupBase -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Where-Object {
            $savedExport = Join-Path $_.FullName 'july30-project-operations-export.json'
            (Test-Path -LiteralPath $savedExport) -and
            (Test-Path -LiteralPath (Join-Path $_.FullName 'browser-storage')) -and
            ((Get-FileHash -Algorithm SHA256 -LiteralPath $savedExport).Hash -eq $ExpectedFileSha256)
        } |
        Select-Object -First 1
    $LocalBackupRoot = if ($reusableBackup) {
        $reusableBackup.FullName
    } else {
        Join-Path $BackupBase (Get-Date -Format 'yyyyMMdd-HHmmss')
    }
}

New-Item -ItemType Directory -Path $LocalBackupRoot -Force | Out-Null
$savedRecoveryExport = Join-Path $LocalBackupRoot 'july30-project-operations-export.json'
if (-not (Test-Path -LiteralPath $savedRecoveryExport)) {
    Copy-Item -LiteralPath $RecoveryExport -Destination $savedRecoveryExport
}
$browserBackup = Join-Path $LocalBackupRoot 'browser-storage'
if (Test-Path -LiteralPath $browserBackup) {
    Write-Host "Reusing the completed local browser backup in $LocalBackupRoot" -ForegroundColor Cyan
} else {
    Write-Host "Preserving local Chrome and Edge storage in $LocalBackupRoot" -ForegroundColor Cyan
    Backup-BrowserStorage -Destination $browserBackup
}

if (-not (Test-Path -LiteralPath (Join-Path $GitAudit '.git'))) {
    Invoke-Native -FilePath git -ArgumentList @('clone', $GitUrl, $GitAudit)
}
Push-Location $GitAudit
try {
    Invoke-Native -FilePath git -ArgumentList @('fetch', 'origin', $ReleaseBranch)
    $releaseCommit = (& git rev-parse "origin/$ReleaseBranch").Trim()
    if ($LASTEXITCODE -ne 0 -or -not $releaseCommit) { throw 'Unable to resolve the release commit.' }
} finally {
    Pop-Location
}

Write-Host 'Uploading the verified recovery inputs and deployment controller...' -ForegroundColor Cyan
Invoke-Native -FilePath ssh -ArgumentList @($Remote, "install -d -m 700 '$RemoteWork'")
Invoke-Native -FilePath scp -ArgumentList @(
    (Join-Path $ProjectRoot 'scripts\deploy-july30-safe-vps.sh'),
    $RecoveryExport,
    "${Remote}:$RemoteWork/"
)
Invoke-Native -FilePath ssh -ArgumentList @(
    $Remote,
    "uploaded='$RemoteWork/$(Split-Path -Leaf $RecoveryExport)'; target='$RemoteWork/july30-project-operations-export.json'; if [ `"`$uploaded`" != `"`$target`" ]; then mv `"`$uploaded`" `"`$target`"; fi; chmod 700 '$RemoteWork/deploy-july30-safe-vps.sh' && EXPECTED_COMMIT='$releaseCommit' bash '$RemoteWork/deploy-july30-safe-vps.sh' recover-deploy"
)

Write-Host 'Downloading verified pre/post recovery backups and reports...' -ForegroundColor Cyan
Invoke-Native -FilePath scp -ArgumentList @(
    "${Remote}:$RemoteWork/pre-recovery-backup.tar",
    "${Remote}:$RemoteWork/post-recovery-backup.tar",
    "${Remote}:$RemoteWork/july30-recovery-plan.json",
    "${Remote}:$RemoteWork/july30-recovery-report.json",
    "${Remote}:$RemoteWork/live-health.json",
    "${Remote}:$RemoteWork/ready-health.json",
    $LocalBackupRoot
)

Write-Host 'Fast-forwarding the verified release into GitHub main...' -ForegroundColor Cyan
Push-Location $GitAudit
try {
    Invoke-Native -FilePath git -ArgumentList @('fetch', 'origin')
    Invoke-Native -FilePath git -ArgumentList @('switch', '-C', 'main', 'origin/main')
    Invoke-Native -FilePath git -ArgumentList @('merge', '--ff-only', "origin/$ReleaseBranch")
    $mainCommit = (& git rev-parse HEAD).Trim()
    if ($mainCommit -ne $releaseCommit) { throw 'Verified release is not the main candidate.' }
    Invoke-Native -FilePath git -ArgumentList @('push', 'origin', 'main')
} finally {
    Pop-Location
}

Write-Host 'Aligning the normal VPS checkout to the exact verified commit...' -ForegroundColor Cyan
Invoke-Native -FilePath ssh -ArgumentList @(
    $Remote,
    "EXPECTED_COMMIT='$releaseCommit' bash '$RemoteWork/deploy-july30-safe-vps.sh' align-main"
)

Write-Host ''
Write-Host 'JULY 30 RECOVERY, BACKUP, GITHUB MAIN, AND VPS DEPLOYMENT COMPLETED SUCCESSFULLY' -ForegroundColor Green
Write-Host "Verified commit: $releaseCommit" -ForegroundColor Green
Write-Host "Independent local recovery bundle: $LocalBackupRoot" -ForegroundColor Green
