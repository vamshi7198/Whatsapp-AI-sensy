# Proves the newest backup can actually be restored.
#
# A backup nobody has restored is a guess. This restores the most recent one
# into a scratch database, counts what came back, and throws the scratch
# database away. It never touches the real one.
#
# Usage:  powershell -File deploy\verify-backup.ps1

param(
    # Left empty so it looks wherever backups actually are. They live off this
    # machine now, so hard-coding the old local folder would have this cheerily
    # report "no backups found" while a year of them sat in Drive.
    [string]$BackupDir = "",
    [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
    [string]$ScratchDb = "uncanned_restore_test"
)

$ErrorActionPreference = "Stop"

# Windows PowerShell turns anything a native program writes to stderr into a
# terminating error under "Stop" — and psql writes ordinary NOTICE lines there.
# Success is judged by exit code instead, which is checked explicitly below.
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$psql = Join-Path $PgBin "psql.exe"
if (-not (Test-Path $psql)) {
    Write-Error "psql not found at $psql"
    exit 1
}

Write-Host ""
Write-Host "Verifying the newest backup" -ForegroundColor Cyan
Write-Host "===========================" -ForegroundColor Cyan
Write-Host ""

# --- Find it -------------------------------------------------------------

# Every place a backup could be, newest wins. The same list backup.ps1 writes
# to, plus the local fallback it uses when Drive is unreachable.
$searchDirs = @(
    "G:\My Drive\Whatsapp Chats",
    "H:\My Drive\Whatsapp Chats",
    (Join-Path $env:USERPROFILE "My Drive\Whatsapp Chats"),
    (Join-Path $env:USERPROFILE "OneDrive\Uncanned WhatsApp Backups"),
    (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "backups")
)

if ($BackupDir) { $searchDirs = @($BackupDir) }

$newest = $searchDirs |
    Where-Object { Test-Path $_ } |
    ForEach-Object { Get-ChildItem $_ -Filter "uncanned_*.sql.zip" -ErrorAction SilentlyContinue } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $newest) {
    Write-Host "No backups found in any of:" -ForegroundColor Red
    $searchDirs | ForEach-Object { Write-Host "  $_" }
    Write-Host ""
    Write-Host "Run deploy\backup.ps1 first."
    exit 1
}

Write-Host "Found in: $($newest.DirectoryName)"

$ageHours = [math]::Round(((Get-Date) - $newest.LastWriteTime).TotalHours, 1)
Write-Host "Newest backup: $($newest.Name)"
Write-Host "Taken:         $($newest.LastWriteTime)  ($ageHours hours ago)"
Write-Host ""

# --- Credentials, from .env rather than a second copy --------------------

$envPath = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path ".env"
$dbUrl = (Get-Content $envPath | Select-String '^DATABASE_URL=').Line

if ($dbUrl -notmatch 'postgresql://([^:]+):([^@]+)@') {
    Write-Error "Could not read DATABASE_URL from .env"
    exit 1
}

$user = $Matches[1]
$env:PGPASSWORD = $Matches[2]

$workDir = Join-Path $env:TEMP "uncanned-restore-test"
if (Test-Path $workDir) { Remove-Item $workDir -Recurse -Force }
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

try {
    # --- Unpack ----------------------------------------------------------

    Write-Host "[1/4] Unpacking..." -ForegroundColor Cyan
    Expand-Archive -Path $newest.FullName -DestinationPath $workDir -Force

    $sqlFile = Get-ChildItem $workDir -Filter "*.sql" | Select-Object -First 1
    if (-not $sqlFile) {
        Write-Host "      The archive contained no .sql file." -ForegroundColor Red
        exit 1
    }

    $sizeMb = [math]::Round($sqlFile.Length / 1MB, 2)
    Write-Host "      $($sqlFile.Name) - $sizeMb MB"

    # --- Restore into a scratch database ---------------------------------

    Write-Host ""
    Write-Host "[2/4] Restoring into $ScratchDb..." -ForegroundColor Cyan

    # Dropped first in case a previous run was interrupted.
    & $psql -h localhost -U $user -d postgres -q -c "DROP DATABASE IF EXISTS $ScratchDb;" 2>$null | Out-Null
    & $psql -h localhost -U $user -d postgres -q -c "CREATE DATABASE $ScratchDb;" 2>$null | Out-Null

    $restoreLog = Join-Path $workDir "restore.log"
    & $psql -h localhost -U $user -d $ScratchDb -f $sqlFile.FullName -v ON_ERROR_STOP=1 > $restoreLog 2>&1

    if ($LASTEXITCODE -ne 0) {
        Write-Host "      RESTORE FAILED" -ForegroundColor Red
        Write-Host ""
        Get-Content $restoreLog -Tail 15 | ForEach-Object { Write-Host "      $_" }
        exit 1
    }

    Write-Host "      Restored without errors." -ForegroundColor Green

    # --- Does it contain anything? ---------------------------------------

    Write-Host ""
    Write-Host "[3/4] Counting what came back..." -ForegroundColor Cyan

    # The tables whose loss would actually hurt. A restore that "succeeds"
    # into an empty database is the failure this step exists to catch.
    #
    # Run from a FILE, not with -c. PowerShell strips the double quotes when it
    # hands SQL to a native program, so FROM "Contact" arrives as FROM Contact,
    # which Postgres folds to lowercase and cannot find. Worse, unquoted `user`
    # is a reserved word that quietly returns the current username — so that one
    # table appeared to pass while every other appeared to be missing.
    $tables = @("Contact", "Message", "Campaign", "Template", "Journey", "User")

    $countSql = Join-Path $workDir "counts.sql"
    ($tables | ForEach-Object { "SELECT '$_' AS t, COUNT(*) AS n FROM ""$_""" }) -join "`nUNION ALL`n" |
        Set-Content $countSql -Encoding utf8

    $problems = 0
    $restored = @{}

    $rows = & $psql -h localhost -U $user -d $ScratchDb -t -A -F "|" -f $countSql 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "      Could not read the restored database." -ForegroundColor Red
        $problems += 1
    } else {
        foreach ($row in $rows) {
            if ($row -match '^([A-Za-z]+)\|(\d+)$') {
                $restored[$Matches[1]] = [int]$Matches[2]
                Write-Host "      $($Matches[1]) : $($Matches[2]) row(s)"
            }
        }

        foreach ($t in $tables) {
            if (-not $restored.ContainsKey($t)) {
                Write-Host "      $t : TABLE MISSING" -ForegroundColor Red
                $problems += 1
            }
        }
    }

    # Compare against the live database, so a truncated backup is obvious.
    Write-Host ""
    Write-Host "      Live database, for comparison:"

    $liveRows = & $psql -h localhost -U $user -d uncanned_whatsapp -t -A -F "|" -f $countSql 2>$null

    foreach ($row in $liveRows) {
        if ($row -match '^([A-Za-z]+)\|(\d+)$') {
            $name = $Matches[1]
            $live = [int]$Matches[2]
            $backedUp = $restored[$name]

            # A backup holding fewer rows than the live database is the failure
            # that would otherwise be discovered only during a real recovery.
            $flag = if ($backedUp -lt $live) { "  <-- FEWER THAN LIVE" } else { "" }
            Write-Host "      $name : $live row(s)$flag" -ForegroundColor $(if ($flag) { "Red" } else { "Gray" })

            if ($flag) { $problems += 1 }
        }
    }

    # --- Clean up --------------------------------------------------------

    Write-Host ""
    Write-Host "[4/4] Removing the scratch database..." -ForegroundColor Cyan
    & $psql -h localhost -U $user -d postgres -q -c "DROP DATABASE IF EXISTS $ScratchDb;" 2>$null | Out-Null
    Write-Host "      Done."

    Write-Host ""
    if ($problems -eq 0) {
        Write-Host "This backup can be restored." -ForegroundColor Green
    } else {
        Write-Host "$problems table(s) were missing from the restore." -ForegroundColor Red
        exit 1
    }
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if (Test-Path $workDir) { Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
