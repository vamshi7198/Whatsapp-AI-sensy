# Registers the web app and worker as Windows services so they start on boot
# and restart if they crash.
#
# Run as Administrator:  powershell -File deploy\install-services.ps1

#Requires -RunAsAdministrator

param(
    [string]$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$NodePath = "C:\Program Files\nodejs\node.exe",
    [string]$NpmPath  = "C:\Program Files\nodejs\npm.cmd"
)

$ErrorActionPreference = "Stop"

$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) {
    Write-Error "nssm not found. Install it first: winget install nssm.nssm"
    exit 1
}

if (-not (Test-Path $NodePath)) {
    Write-Error "Node not found at $NodePath. Pass -NodePath with the correct location."
    exit 1
}

if (-not (Test-Path (Join-Path $AppRoot ".next"))) {
    Write-Error "No production build found. Run 'npm run build' first."
    exit 1
}

$logDir = Join-Path $AppRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Install-AppService {
    param(
        [string]$Name,
        [string]$Executable,
        [string]$Arguments,
        [string]$Description
    )

    $existing = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  Stopping and removing existing $Name..."
        & $nssm stop $Name confirm 2>$null | Out-Null
        & $nssm remove $Name confirm | Out-Null
        Start-Sleep -Seconds 2
    }

    & $nssm install $Name $Executable $Arguments | Out-Null
    & $nssm set $Name AppDirectory $AppRoot | Out-Null
    & $nssm set $Name Description $Description | Out-Null
    & $nssm set $Name Start SERVICE_AUTO_START | Out-Null

    # Restart on failure, with a short pause so a crash loop does not spin.
    & $nssm set $Name AppExit Default Restart | Out-Null
    & $nssm set $Name AppRestartDelay 5000 | Out-Null

    # Rotate logs so they cannot fill the disk over months of running.
    & $nssm set $Name AppStdout (Join-Path $logDir "$Name.out.log") | Out-Null
    & $nssm set $Name AppStderr (Join-Path $logDir "$Name.err.log") | Out-Null
    & $nssm set $Name AppRotateFiles 1 | Out-Null
    & $nssm set $Name AppRotateBytes 10485760 | Out-Null

    Write-Host "  Installed $Name" -ForegroundColor Green
}

Write-Host "Installing services from $AppRoot"
Write-Host ""

Install-AppService `
    -Name "UncannedWhatsAppWeb" `
    -Executable $NpmPath `
    -Arguments "run start" `
    -Description "Uncanned WhatsApp web application"

Install-AppService `
    -Name "UncannedWhatsAppWorker" `
    -Executable $NpmPath `
    -Arguments "run worker:start" `
    -Description "Uncanned WhatsApp background sending worker"

Write-Host ""
Write-Host "Starting web service..."
Start-Service UncannedWhatsAppWeb
Start-Sleep -Seconds 5
Get-Service Uncanned* | Select-Object Name, Status, StartType | Format-Table -AutoSize

Write-Host ""
Write-Host "The worker is not started yet: it needs Redis, which is only" -ForegroundColor Yellow
Write-Host "required once campaign sending is in use. Start it with:"
Write-Host "  Start-Service UncannedWhatsAppWorker"
Write-Host ""
Write-Host "Logs: $logDir"
