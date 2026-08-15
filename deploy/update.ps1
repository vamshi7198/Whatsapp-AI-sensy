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
    # The app is stopped while this runs, so a build that never returns is an
    # outage rather than a slow deploy. A healthy build takes about two
    # minutes; ten is generous and still bounded.
    [int]$BuildTimeoutSeconds = 600,
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

    # Nothing may still be holding .next open. A worker left behind by a
    # previous run keeps a lock on Windows, and the build then blocks writing
    # over it rather than failing.
    Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    # Build output cleared, cache kept.
    #
    # A build once hung for ten minutes at "Collecting page data" against an
    # existing .next, and the same build finished in under two against a clean
    # one. That is suggestive rather than proof, but a stale build directory
    # buys nothing: .next/cache is what makes a rebuild fast, and it survives.
    if (Test-Path ".next") {
        Get-ChildItem ".next" -Force |
            Where-Object { $_.Name -ne "cache" } |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }

    # Run with a deadline.
    #
    # The app is ALREADY STOPPED at this point, so a build that never returns
    # is not a slow deploy — it is an outage that lasts until somebody notices
    # and intervenes. A plain `npm run build` gives no way out of that. As a
    # job it can be given up on, and the previous version put back.
    $build = Start-Job -ScriptBlock {
        param($root, $npm)
        Set-Location $root
        & $npm run build 2>&1
        $LASTEXITCODE
    } -ArgumentList (Get-Location).Path, $NpmPath

    if (-not (Wait-Job $build -Timeout $BuildTimeoutSeconds)) {
        Write-Host ""
        Write-Host "The build has not finished after $BuildTimeoutSeconds seconds." -ForegroundColor Red
        Write-Host "Giving up on it and putting the previous version back." -ForegroundColor Yellow

        Stop-Job $build -ErrorAction SilentlyContinue
        Remove-Job $build -Force -ErrorAction SilentlyContinue
        Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

        Start-ScheduledTask -TaskName $TaskName
        Write-Error "Build timed out. The site is running the previous version - nothing was deployed."
        exit 1
    }

    Receive-Job $build | ForEach-Object { Write-Host $_ }
    $buildFailed = ($build.State -eq "Failed")
    Remove-Job $build -Force -ErrorAction SilentlyContinue

    if ($buildFailed) {
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
