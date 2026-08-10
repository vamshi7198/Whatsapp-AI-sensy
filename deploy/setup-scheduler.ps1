# Registers the task that starts scheduled campaigns.
#
# Scheduled campaigns need something to wake up and check whether their time
# has arrived. A timer inside the app is not good enough: it dies whenever the
# app restarts, so a campaign set for 9am would silently never send if the
# machine had been switched off overnight.
#
# This runs every 5 minutes, whether or not anyone is logged in, and does
# nothing when nothing is due.
#
# Run once, as Administrator:
#   powershell -ExecutionPolicy Bypass -File deploy\setup-scheduler.ps1

#Requires -RunAsAdministrator

param(
    [string]$AppRoot   = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$NpmPath   = "C:\Program Files\nodejs\npm.cmd",
    [string]$TaskName  = "UncannedWhatsAppScheduler",
    [int]$EveryMinutes = 5
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Setting up the campaign scheduler" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $NpmPath)) {
    Write-Error "Could not find npm at $NpmPath. Install Node.js or pass -NpmPath."
    exit 1
}

if (-not (Test-Path (Join-Path $AppRoot "package.json"))) {
    Write-Error "$AppRoot does not look like the app folder."
    exit 1
}

$action = New-ScheduledTaskAction `
    -Execute $NpmPath `
    -Argument "run scheduler" `
    -WorkingDirectory $AppRoot

# Repeats indefinitely from the moment it is registered. -AtStartup on its own
# would only fire once per boot, which is not a scheduler.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)

# SYSTEM so it runs with nobody logged in - the machine may be locked, and a
# campaign scheduled for 7am must still send.
$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Replacing the existing task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Starts Uncanned WhatsApp campaigns that were scheduled for later." | Out-Null

Write-Host "Registered. Checking every $EveryMinutes minutes." -ForegroundColor Green
Write-Host ""

Write-Host "Testing it now..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 8

$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "  Last run:     $($info.LastRunTime)"
Write-Host "  Result code:  $($info.LastTaskResult)  (0 means success)"
Write-Host "  Next run:     $($info.NextRunTime)"
Write-Host ""

if ($info.LastTaskResult -ne 0) {
    Write-Host "The test run did not succeed. Check it by hand with:" -ForegroundColor Yellow
    Write-Host "  cd $AppRoot" -ForegroundColor Yellow
    Write-Host "  npm run scheduler" -ForegroundColor Yellow
} else {
    Write-Host "Scheduled campaigns will now send on time." -ForegroundColor Green
}

Write-Host ""
