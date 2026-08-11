# Gets Uncanned WhatsApp running, and keeps it running after a reboot.
#
# Three separate things have to be up for whatsapp.uncanned.in to work:
#
#   1. PostgreSQL      - the database
#   2. The app itself  - Next.js on port 3000
#   3. cloudflared     - the tunnel that puts port 3000 on the internet
#
# The database and the tunnel install themselves as Windows services and come
# back on their own. The app does not: it needs a scheduled task, and if that
# task is missing then after every reboot the tunnel is up with nothing behind
# it, which looks exactly like "the site is down".
#
# This checks all three, fixes what is broken, and says what it found.
#
# Run as Administrator:
#   powershell -ExecutionPolicy Bypass -File deploy\repair.ps1

#Requires -RunAsAdministrator

param(
    [string]$AppRoot  = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$NodePath = "C:\Program Files\nodejs\node.exe",
    [string]$TaskName = "UncannedWhatsApp",
    [string]$PublicUrl = "https://whatsapp.uncanned.in/login"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Repairing Uncanned WhatsApp" -ForegroundColor Cyan
Write-Host "===========================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Database ----------------------------------------------------------

Write-Host "[1/4] Database" -ForegroundColor Cyan

$pg = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $pg) {
    Write-Host "      PostgreSQL is not installed. Nothing can work without it." -ForegroundColor Red
    exit 1
}

if ($pg.Status -ne "Running") {
    Write-Host "      Starting PostgreSQL..." -ForegroundColor Yellow
    Start-Service $pg.Name
    Start-Sleep -Seconds 3
}

if ((Get-Service $pg.Name).StartType -ne "Automatic") {
    Write-Host "      Setting it to start with Windows..." -ForegroundColor Yellow
    Set-Service $pg.Name -StartupType Automatic
}

Write-Host "      Running, and starts with Windows." -ForegroundColor Green

# --- 2. The app -----------------------------------------------------------

Write-Host ""
Write-Host "[2/4] The app" -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $AppRoot ".next"))) {
    Write-Host "      No build found. Run the update first, then try again." -ForegroundColor Red
    Write-Host "      Double-click: Update Uncanned WhatsApp"
    exit 1
}

# A copy started by hand holds port 3000, and the scheduled task would then
# fail to bind to it. Only the process actually listening on 3000 is stopped -
# not every node process on the machine.
$holders = @()
try {
    $holders = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop |
               Select-Object -ExpandProperty OwningProcess -Unique
} catch {
    # Nothing listening; nothing to clear.
}

$taskPids = @()
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($task) {
    Write-Host "      Stopping the app..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
}

foreach ($processId in $holders) {
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq "node") {
        Write-Host "      Closing a copy that was started by hand (process $processId)..." -ForegroundColor Yellow
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}

$nextBin = Join-Path $AppRoot "node_modules\next\dist\bin\next"

if (-not (Test-Path $nextBin)) {
    Write-Host "      Next.js is missing. Run 'npm ci' in $AppRoot." -ForegroundColor Red
    exit 1
}

if ($task) {
    Write-Host "      Startup task already exists - re-registering it so its"
    Write-Host "      settings are known good."
} else {
    Write-Host "      Startup task is MISSING - this is why it does not come back" -ForegroundColor Yellow
    Write-Host "      after a reboot. Creating it now..." -ForegroundColor Yellow
}

# Registered fresh either way, so a task pointing at an old path is corrected
# rather than left half-working.
if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument "`"$nextBin`" start" `
    -WorkingDirectory $AppRoot

# At startup, so it returns after a reboot with nobody logged in.
$trigger = New-ScheduledTaskTrigger -AtStartup

# Wait a minute before starting. "At startup" fires very early — often before
# networking and PostgreSQL are ready — and an app that starts into a machine
# with no database can exit before Windows would ever retry it. A minute costs
# nothing and removes a whole class of "it did not come back" failures.
$trigger.Delay = "PT1M"

$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# ExecutionTimeLimit 0 means "never kill it for running too long" - it is
# supposed to run forever.
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
    -Description "Uncanned WhatsApp - starts with Windows" | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "      Started, and set to start with Windows." -ForegroundColor Green

# --- 3. Tunnel ------------------------------------------------------------

Write-Host ""
Write-Host "[3/4] Internet tunnel" -ForegroundColor Cyan

$cf = Get-Service cloudflared -ErrorAction SilentlyContinue

if (-not $cf) {
    Write-Host "      The cloudflared service is not installed, so the public" -ForegroundColor Red
    Write-Host "      address cannot work. See deploy\THIS-MACHINE.md." -ForegroundColor Red
} else {
    if ($cf.Status -ne "Running") {
        Write-Host "      Starting the tunnel..." -ForegroundColor Yellow
        Start-Service cloudflared
        Start-Sleep -Seconds 3
    }

    if ((Get-Service cloudflared).StartType -ne "Automatic") {
        Write-Host "      Setting it to start with Windows..." -ForegroundColor Yellow
        Set-Service cloudflared -StartupType Automatic
    }

    Write-Host "      Running, and starts with Windows." -ForegroundColor Green
}

# --- 4. Does it actually answer? ------------------------------------------

Write-Host ""
Write-Host "[4/4] Checking it answers" -ForegroundColor Cyan

$localOk = $false
for ($i = 1; $i -le 12; $i++) {
    Start-Sleep -Seconds 5
    try {
        if ((Invoke-WebRequest -Uri "http://localhost:3000/login" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) {
            $localOk = $true
            break
        }
    } catch {
        Write-Host "      starting up ($i of 12)..."
    }
}

Write-Host ""

if ($localOk) {
    Write-Host "  On this computer:  working" -ForegroundColor Green
} else {
    Write-Host "  On this computer:  NOT working" -ForegroundColor Red
    Write-Host "  Check the task in Task Scheduler under the name $TaskName."
}

try {
    if ((Invoke-WebRequest -Uri $PublicUrl -UseBasicParsing -TimeoutSec 25).StatusCode -eq 200) {
        Write-Host "  whatsapp.uncanned.in: working" -ForegroundColor Green
    }
} catch {
    Write-Host "  whatsapp.uncanned.in: NOT working" -ForegroundColor Red
    Write-Host "  The app is up but the tunnel is not reaching it."
    Write-Host "  Check with: Get-Service cloudflared"
}

Write-Host ""
Write-Host "This machine will now bring everything back by itself after a restart." -ForegroundColor Cyan
Write-Host ""
