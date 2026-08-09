# Makes Uncanned WhatsApp start automatically with Windows.
#
# Uses Windows Task Scheduler rather than a third-party service wrapper, so
# there is nothing extra to install.
#
# Run ONCE, as Administrator:
#   powershell -ExecutionPolicy Bypass -File deploy\setup-autostart.ps1

#Requires -RunAsAdministrator

param(
    [string]$AppRoot   = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$NodePath  = "C:\Program Files\nodejs\node.exe",
    [string]$Cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe",
    [switch]$SkipTunnel
)

$ErrorActionPreference = "Stop"
$TaskName = "UncannedWhatsApp"

Write-Host ""
Write-Host "Setting up Uncanned WhatsApp to start automatically" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

# --- Checks ---------------------------------------------------------------

if (-not (Test-Path $NodePath)) {
    Write-Error "Node.js not found at $NodePath"
    exit 1
}

$nextBin = Join-Path $AppRoot "node_modules\next\dist\bin\next"
if (-not (Test-Path $nextBin)) {
    Write-Error "Next.js not found. Run 'npm ci' in $AppRoot first."
    exit 1
}

if (-not (Test-Path (Join-Path $AppRoot ".next"))) {
    Write-Error "No production build found. Run 'npm run build' in $AppRoot first."
    exit 1
}

Write-Host "[1/3] Checks passed" -ForegroundColor Green

# --- Scheduled task for the web app ---------------------------------------

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "      Removing previous task..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument "`"$nextBin`" start" `
    -WorkingDirectory $AppRoot

# At startup so it comes back after a reboot without anyone logging in.
$trigger = New-ScheduledTaskTrigger -AtStartup

$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

# Restart on failure, and never stop it for running "too long" - it is meant
# to run forever.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Uncanned WhatsApp - internal WhatsApp management platform" | Out-Null

Write-Host "[2/3] Startup task created" -ForegroundColor Green

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 8

# --- Cloudflare tunnel service --------------------------------------------

if ($SkipTunnel) {
    Write-Host "[3/3] Skipped the tunnel (as requested)" -ForegroundColor Yellow
} elseif (-not (Test-Path $Cloudflared)) {
    Write-Host "[3/3] cloudflared not found at $Cloudflared - skipping" -ForegroundColor Yellow
} else {
    $configPath = Join-Path $env:USERPROFILE ".cloudflared\config.yml"

    if (-not (Test-Path $configPath)) {
        Write-Host "[3/3] No tunnel config yet at $configPath - skipping" -ForegroundColor Yellow
        Write-Host "      Create the tunnel first, then re-run this script."
    } else {
        $svc = Get-Service cloudflared -ErrorAction SilentlyContinue
        if ($svc) {
            Write-Host "      Reinstalling the tunnel service..."
            & $Cloudflared service uninstall 2>$null | Out-Null
            Start-Sleep -Seconds 2
        }

        & $Cloudflared service install
        Start-Sleep -Seconds 3
        Write-Host "[3/3] Tunnel service installed" -ForegroundColor Green
    }
}

# --- Report ---------------------------------------------------------------

Write-Host ""
Write-Host "Current state" -ForegroundColor Cyan
Get-ScheduledTask -TaskName $TaskName |
    Select-Object TaskName, State | Format-Table -AutoSize

Get-Service cloudflared -ErrorAction SilentlyContinue |
    Select-Object Name, Status | Format-Table -AutoSize

Write-Host "Checking the app responds..."
Start-Sleep -Seconds 3
try {
    $code = (Invoke-WebRequest -Uri "http://localhost:3000/login" -UseBasicParsing -TimeoutSec 15).StatusCode
    if ($code -eq 200) {
        Write-Host "  The app is running on this machine." -ForegroundColor Green
    }
} catch {
    Write-Host "  Not responding yet - it can take up to a minute to start." -ForegroundColor Yellow
    Write-Host "  Check again with: Invoke-WebRequest http://localhost:3000/login"
}

Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Cyan
Write-Host "  Restart the app:  Stop-ScheduledTask -TaskName $TaskName; Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Stop the app:     Stop-ScheduledTask -TaskName $TaskName"
Write-Host "  Tunnel status:    Get-Service cloudflared"
Write-Host ""
