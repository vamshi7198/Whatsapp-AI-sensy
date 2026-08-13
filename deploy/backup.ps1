# Backs up the database to a timestamped, compressed file.
#
# Running the app yourself means the data is yours - which also means nobody
# else is backing it up. Schedule this daily in Task Scheduler and keep a copy
# somewhere off this machine.
#
# Usage:  powershell -File deploy\backup.ps1 [-BackupDir D:\backups] [-KeepDays 14]

param(
    [string]$BackupDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "backups"),
    # A second copy somewhere that survives this machine. A backup on the same
    # disk as the database protects against almost nothing — not a failed
    # drive, not a stolen laptop, not ransomware.
    #
    # Left empty so it can be worked out at run time: Google Drive is preferred
    # when present, OneDrive otherwise. Pass -OffsiteDir to override.
    [string]$OffsiteDir = "",
    [int]$KeepDays = 14,
    [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
    [string]$Database = "uncanned_whatsapp",
    [string]$User = "uncanned"
)

$ErrorActionPreference = "Stop"

# --- Where the offsite copy goes -----------------------------------------

# Worked out each run rather than fixed at install time, so installing Google
# Drive later starts using it without anyone remembering to change a setting.
# A synced FOLDER, deliberately, not an API: a folder cannot have its
# credentials expire eight weeks into an unattended run and fail in silence.
if (-not $OffsiteDir) {
    # The folder Uncanned actually uses comes first. The rest are fallbacks so
    # this still works on a machine where Drive is not installed, or if the
    # drive letter differs after a reinstall.
    $preferred = @(
        "G:\My Drive\Whatsapp Chats",
        "H:\My Drive\Whatsapp Chats",
        (Join-Path $env:USERPROFILE "My Drive\Whatsapp Chats")
    )

    foreach ($p in $preferred) {
        if (Test-Path $p) { $OffsiteDir = $p; break }
    }

    if (-not $OffsiteDir) {
        $folderName = "Uncanned WhatsApp Backups"

        foreach ($root in @(
            "G:\My Drive",
            "H:\My Drive",
            (Join-Path $env:USERPROFILE "My Drive"),
            (Join-Path $env:USERPROFILE "Google Drive"),
            (Join-Path $env:USERPROFILE "OneDrive")
        )) {
            if (Test-Path $root) {
                $OffsiteDir = Join-Path $root $folderName
                break
            }
        }
    }
}

$pgDump = Join-Path $PgBin "pg_dump.exe"
if (-not (Test-Path $pgDump)) {
    Write-Error "pg_dump not found at $pgDump"
    exit 1
}

# Read the password from .env rather than duplicating it in a second place.
$envPath = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path ".env"
$dbUrl = (Get-Content $envPath | Select-String '^DATABASE_URL=').Line
if ($dbUrl -match 'postgresql://([^:]+):([^@]+)@') {
    $env:PGPASSWORD = $Matches[2]
    $User = $Matches[1]
} else {
    Write-Error "Could not read DATABASE_URL from .env"
    exit 1
}

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$outFile = Join-Path $BackupDir "uncanned_$stamp.sql"

Write-Host "Backing up $Database..."
& $pgDump -h localhost -U $User -d $Database -f $outFile --no-owner --no-privileges

if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD
    Write-Error "Backup failed"
    exit 1
}

Remove-Item Env:PGPASSWORD

Compress-Archive -Path $outFile -DestinationPath "$outFile.zip" -Force
Remove-Item $outFile

$sizeMb = [math]::Round((Get-Item "$outFile.zip").Length / 1MB, 2)
Write-Host "Saved $outFile.zip ($sizeMb MB)" -ForegroundColor Green

# --- The copy that survives this machine ---------------------------------

if ($OffsiteDir) {
    try {
        if (-not (Test-Path $OffsiteDir)) {
            New-Item -ItemType Directory -Path $OffsiteDir -Force | Out-Null
        }

        Copy-Item "$outFile.zip" -Destination $OffsiteDir -Force
        Write-Host "Copied to $OffsiteDir" -ForegroundColor Green

        # Pruned separately: the offsite copy is the one that matters, so it
        # is kept longer than the local one.
        $offsiteCutoff = (Get-Date).AddDays(-($KeepDays * 3))
        Get-ChildItem $OffsiteDir -Filter "uncanned_*.sql.zip" -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt $offsiteCutoff } |
            ForEach-Object { Remove-Item $_.FullName -ErrorAction SilentlyContinue }
    } catch {
        # Never fatal. A local backup with no offsite copy is still far better
        # than no backup because OneDrive happened to be signed out.
        Write-Host "Could not copy offsite: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "The local backup was still saved." -ForegroundColor Yellow
    }
}

# Tell the app a backup happened, so /api/health can report one that has
# stopped running. Never fatal: a backup that succeeded is a backup whether or
# not the timestamp got written.
try {
    $npm = "C:\Program Files\nodejs\npm.cmd"
    if (Test-Path $npm) {
        Push-Location (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
        & $npm run --silent record-backup 2>$null | Out-Null
        Pop-Location
    }
} catch {
    Write-Host "Could not record the backup time (harmless)." -ForegroundColor DarkGray
}

# Prune old backups so the disk does not fill silently over months.
$cutoff = (Get-Date).AddDays(-$KeepDays)
$removed = Get-ChildItem $BackupDir -Filter "uncanned_*.sql.zip" |
    Where-Object { $_.LastWriteTime -lt $cutoff }

foreach ($old in $removed) {
    Remove-Item $old.FullName
    Write-Host "  Removed old backup: $($old.Name)"
}

Write-Host ""
Write-Host "A backup that has never been restored is not a backup." -ForegroundColor Yellow
Write-Host "Test one occasionally:"
Write-Host "  createdb -U postgres restore_test"
Write-Host "  psql -U postgres -d restore_test -f <unzipped .sql file>"
