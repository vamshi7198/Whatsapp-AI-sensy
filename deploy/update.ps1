# Builds and restarts the app in one step.
#
# Next.js production loads its build at startup and keeps referring to those
# files. Running `npm run build` while the app is live replaces them
# underneath the running process, and pages that were changed start returning
# 500 until it is restarted - with nothing in the logs to explain why.
#
# So build and restart belong together, and this script is the only supported
# way to apply a change.
#
# Run as Administrator:
#   powershell -ExecutionPolicy Bypass -File deploy\update.ps1

#Requires -RunAsAdministrator

param(
    [string]$AppRoot  = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$NpmPath  = "C:\Program Files\nodejs\npm.cmd",
    [string]$TaskName = "UncannedWhatsApp",
    [string]$HealthUrl = "http://localhost:3000/login",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-Location $AppRoot

Write-Host ""
Write-Host "Updating Uncanned WhatsApp" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan
Write-Host ""

if (-not $SkipBuild) {
    Write-Host "[1/4] Checking the code..." -ForegroundColor Cyan
    & $NpmPath run verify
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Checks failed. Nothing was changed - the running app is untouched."
        exit 1
    }

    Write-Host ""
    Write-Host "[2/4] Building..." -ForegroundColor Cyan

    # Stop first: replacing .next under a live process is what causes the
    # 500s this script exists to prevent.
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3

    & $NpmPath run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed - restarting the previous version..." -ForegroundColor Yellow
        Start-ScheduledTask -TaskName $TaskName
        Write-Error "Build failed."
        exit 1
    }
} else {
    Write-Host "[1-2/4] Skipping build as requested" -ForegroundColor Yellow
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
}

Write-Host ""
Write-Host "[3/4] Starting..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "[4/4] Waiting for it to answer..." -ForegroundColor Cyan

$ok = $false
for ($i = 1; $i -le 12; $i++) {
    Start-Sleep -Seconds 5
    try {
        $code = (Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 10).StatusCode
        if ($code -eq 200) { $ok = $true; break }
    } catch {
        Write-Host "  not ready yet ($i of 12)..."
    }
}

Write-Host ""
if ($ok) {
    # Catch any message that was received but never applied - for example if
    # the machine lost power between storing it and putting it in the inbox.
    Write-Host "Checking for missed messages..." -ForegroundColor Cyan
    & $NpmPath run recover
    Write-Host ""

    Write-Host "Updated and running." -ForegroundColor Green
    try {
        $public = (Invoke-WebRequest -Uri "https://whatsapp.uncanned.in/login" -UseBasicParsing -TimeoutSec 20).StatusCode
        if ($public -eq 200) {
            Write-Host "https://whatsapp.uncanned.in is reachable." -ForegroundColor Green
        }
    } catch {
        Write-Host "The public address did not answer - check: Get-Service cloudflared" -ForegroundColor Yellow
    }
} else {
    Write-Host "The app did not start." -ForegroundColor Red
    Write-Host "Check with: Get-ScheduledTask -TaskName $TaskName"
}

Write-Host ""
