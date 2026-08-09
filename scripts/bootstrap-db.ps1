# Creates the application role and database on a native PostgreSQL install.
#
# docker-compose provisions these automatically from environment variables; a
# native install ships only the `postgres` superuser, so they must be created
# once by hand. Idempotent — safe to re-run.
#
# Usage:  powershell -File scripts\bootstrap-db.ps1

param(
    [string]$SuperUser     = "postgres",
    [string]$SuperPassword = "uncanned_local_dev",
    [string]$AppUser       = "uncanned",
    [string]$AppPassword   = "uncanned_local_dev",
    [string]$AppDatabase   = "uncanned_whatsapp",
    [string]$PgBin         = "C:\Program Files\PostgreSQL\16\bin"
)

$psql = Join-Path $PgBin "psql.exe"
if (-not (Test-Path $psql)) {
    Write-Error "psql not found at $psql. Adjust -PgBin to your PostgreSQL install."
    exit 1
}

$env:PGPASSWORD = $SuperPassword

Write-Host "Creating role '$AppUser'..."
$roleSql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$AppUser') THEN
    CREATE ROLE $AppUser LOGIN PASSWORD '$AppPassword';
  END IF;
END
`$`$;
"@
& $psql -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -c $roleSql
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to create role"; exit 1 }

# CREATE DATABASE cannot run inside a DO block, so existence is checked first.
$exists = & $psql -U $SuperUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$AppDatabase'"
if ($exists -ne "1") {
    Write-Host "Creating database '$AppDatabase'..."
    & $psql -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $AppDatabase OWNER $AppUser"
    if ($LASTEXITCODE -ne 0) { Write-Error "Failed to create database"; exit 1 }
} else {
    Write-Host "Database '$AppDatabase' already exists."
}

# Prisma Migrate needs to create a shadow database during `migrate dev`, which
# requires CREATEDB on the application role.
& $psql -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE $AppUser CREATEDB"

Remove-Item Env:PGPASSWORD
Write-Host "Database bootstrap complete."
