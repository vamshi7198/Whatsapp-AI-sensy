# Backs up the database to Google Drive.
#
# Running the app yourself means the data is yours - which also means nobody
# else is backing it up. This is scheduled daily by deploy\repair.ps1.
#
# The finished backup goes OFF this machine and is not kept on it. A copy on
# the same disk as the database protects against nothing that actually happens
# to laptops: a failed drive, a theft, ransomware. It only consumes space.
#
# The one exception is when the offsite copy fails - Drive signed out, folder
# renamed, machine offline. Then the backup is kept locally rather than thrown
# away, and the script says so, because a local backup beats none.
#
# Usage:  powershell -File deploy\backup.ps1 [-OffsiteDir "G:\My Drive\..."]

param(
    # Where backups actually live. Worked out at run time when empty, so
    # reinstalling Drive on a different letter does not silently stop this.
    [string]$OffsiteDir = "",
    # Only used when the offsite copy fails.
    [string]$FallbackDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "backups"),
    # 0 means never delete anything. Chosen deliberately: a backup is about
    # 0.03 MB, so a decade of daily ones is a few hundred megabytes in Drive,
    # and the only thing automatic deletion could ever achieve here is losing
    # the copy somebody eventually needs. Pass a number of days to prune.
    [int]$KeepDays = 0,
    [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
    [string]$Database = "uncanned_whatsapp",
    [string]$User = "uncanned"
)

$ErrorActionPreference = "Stop"

# --- Where it goes --------------------------------------------------------

if (-not $OffsiteDir) {
    # The folder Uncanned actually uses comes first; the rest are fallbacks for
    # a different drive letter or a machine without Drive installed.
    $preferred = @(
        "G:\My Drive\Whatsapp Chats",
        "H:\My Drive\Whatsapp Chats",
        (Join-Path $env:USERPROFILE "My Drive\Whatsapp Chats")
    )

    foreach ($p in $preferred) {
        if (Test-Path $p) { $OffsiteDir = $p; break }
    }

    if (-not $OffsiteDir) {
        foreach ($root in @(
            "G:\My Drive",
            "H:\My Drive",
            (Join-Path $env:USERPROFILE "My Drive"),
            (Join-Path $env:USERPROFILE "Google Drive"),
            (Join-Path $env:USERPROFILE "OneDrive")
        )) {
            if (Test-Path $root) {
                $OffsiteDir = Join-Path $root "Uncanned WhatsApp Backups"
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
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envPath = Join-Path $appRoot ".env"
$dbUrl = (Get-Content $envPath | Select-String '^DATABASE_URL=').Line

if ($dbUrl -match 'postgresql://([^:]+):([^@]+)@') {
    $env:PGPASSWORD = $Matches[2]
    $User = $Matches[1]
} else {
    Write-Error "Could not read DATABASE_URL from .env"
    exit 1
}

# --- Dump, into scratch space --------------------------------------------

# Written to TEMP rather than the project folder, so the uncompressed dump
# never sits on the app disk any longer than it takes to zip it.
$work = Join-Path $env:TEMP "uncanned-backup"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Path $work -Force | Out-Null

$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$sqlFile = Join-Path $work "uncanned_$stamp.sql"
$zipFile = "$sqlFile.zip"

try {
    Write-Host "Backing up $Database..."
    & $pgDump -h localhost -U $User -d $Database -f $sqlFile --no-owner --no-privileges

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Backup failed - the database could not be read."
        exit 1
    }

    Compress-Archive -Path $sqlFile -DestinationPath $zipFile -Force
    Remove-Item $sqlFile

    $sizeMb = [math]::Round((Get-Item $zipFile).Length / 1MB, 2)

    # --- Off this machine -------------------------------------------------

    $landed = $null

    if ($OffsiteDir) {
        try {
            if (-not (Test-Path $OffsiteDir)) {
                New-Item -ItemType Directory -Path $OffsiteDir -Force | Out-Null
            }

            Copy-Item $zipFile -Destination $OffsiteDir -Force

            # Confirm it actually arrived. Copy-Item can succeed against a
            # sync folder that is not really writable.
            $check = Join-Path $OffsiteDir (Split-Path $zipFile -Leaf)
            if (Test-Path $check) {
                $landed = $OffsiteDir
                Write-Host "Saved to $OffsiteDir ($sizeMb MB)" -ForegroundColor Green
            }
        } catch {
            Write-Host "Could not write to $OffsiteDir" -ForegroundColor Yellow
            Write-Host "  $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    # --- Keep it locally only if it could not go anywhere else ------------

    if (-not $landed) {
        if (-not (Test-Path $FallbackDir)) {
            New-Item -ItemType Directory -Path $FallbackDir -Force | Out-Null
        }

        Copy-Item $zipFile -Destination $FallbackDir -Force

        Write-Host ""
        Write-Host "WARNING: this backup could NOT be sent off this machine." -ForegroundColor Red
        Write-Host "It was kept at $FallbackDir instead." -ForegroundColor Red
        Write-Host "Check that Google Drive is signed in and syncing." -ForegroundColor Red
        Write-Host ""
    }

    # --- Tell the app, so /api/health can report a stalled backup ---------

    try {
        $npm = "C:\Program Files\nodejs\npm.cmd"
        if (Test-Path $npm) {
            Push-Location $appRoot
            & $npm run --silent record-backup 2>$null | Out-Null
            Pop-Location
        }
    } catch {
        Write-Host "Could not record the backup time (harmless)." -ForegroundColor DarkGray
    }

    # --- Prune, only if asked ---------------------------------------------

    # Off by default. Nothing is deleted unless a retention period is passed
    # in, so the only way to lose an old backup is to ask for it.
    if ($KeepDays -gt 0) {
        $cutoff = (Get-Date).AddDays(-$KeepDays)

        foreach ($dir in @($OffsiteDir, $FallbackDir)) {
            if (-not $dir -or -not (Test-Path $dir)) { continue }

            $old = Get-ChildItem $dir -Filter "uncanned_*.sql.zip" -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -lt $cutoff }

            foreach ($o in $old) {
                Remove-Item $o.FullName -ErrorAction SilentlyContinue
                Write-Host "  Removed backup older than $KeepDays days: $($o.Name)"
            }
        }
    }
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    # The scratch copy never outlives the run, whatever happened above.
    if (Test-Path $work) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host "A backup that has never been restored is not a backup." -ForegroundColor DarkGray
Write-Host "Check one occasionally:  powershell -File deploy\verify-backup.ps1" -ForegroundColor DarkGray
Write-Host ""
