# Backs up the database to a timestamped, compressed file.
#
# Running the app yourself means the data is yours - which also means nobody
# else is backing it up. Schedule this daily in Task Scheduler and keep a copy
# somewhere off this machine.
#
# Usage:  powershell -File deploy\backup.ps1 [-BackupDir D:\backups] [-KeepDays 14]

param(
    [string]$BackupDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "backups"),
    [int]$KeepDays = 14,
    [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
    [string]$Database = "uncanned_whatsapp",
    [string]$User = "uncanned"
)

$ErrorActionPreference = "Stop"

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
