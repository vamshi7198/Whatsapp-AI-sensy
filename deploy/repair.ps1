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
    [string]$NpmPath  = "C:\Program Files\nodejs\npm.cmd",
    [string]$TaskName = "UncannedWhatsApp",
    [string]$PublicUrl = "https://whatsapp.uncanned.in/login"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Repairing Uncanned WhatsApp" -ForegroundColor Cyan
Write-Host "===========================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Database ----------------------------------------------------------

Write-Host "[1/5] Database" -ForegroundColor Cyan

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
Write-Host "[2/5] The app" -ForegroundColor Cyan

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

# --- 3. Scheduler and backups --------------------------------------------

Write-Host ""
Write-Host "[3/5] Scheduled work" -ForegroundColor Cyan

# Registers a repeating task, replacing any previous version so its settings
# are known good rather than whatever a half-finished earlier run left behind.
function Register-Repeating {
    param(
        [string]$Name,
        [string]$Arguments,
        [int]$EveryMinutes,
        [string]$Description
    )

    $action = New-ScheduledTaskAction -Execute $NpmPath -Argument $Arguments -WorkingDirectory $AppRoot

    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)

    # SYSTEM, so it runs with nobody logged in. A campaign scheduled for 7am
    # must still send while the machine sits at a lock screen.
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" `
        -LogonType ServiceAccount -RunLevel Highest

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2)

    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    }

    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Description $Description | Out-Null
}

# Every 5 minutes: sends due campaigns, resumes journeys whose wait has ended,
# and picks up anything a restart left half-done.
Register-Repeating -Name "UncannedWhatsAppScheduler" `
    -Arguments "run scheduler" -EveryMinutes 5 `
    -Description "Sends scheduled campaigns and resumes waiting conversations."

Write-Host "      Scheduler: every 5 minutes." -ForegroundColor Green

# Daily: a compressed copy of the database. Nobody else is backing this up.
$backupAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -File `"$AppRoot\deploy\backup.ps1`"" `
    -WorkingDirectory $AppRoot

$backupTrigger = New-ScheduledTaskTrigger -Daily -At "02:30"

# Runs as the signed-in user, NOT as SYSTEM like the other two tasks.
#
# Google Drive's G: is a virtual drive mounted inside a user's session, not a
# volume the machine has. Get-Volume -DriveLetter G returns nothing at all. A
# SYSTEM ServiceAccount task has no session, so it cannot see G: no matter what
# permissions it holds — every probe in backup.ps1 fails, $OffsiteDir comes out
# empty, and the backup can only ever land in the local fallback.
#
# That is how backups stopped reaching Drive while the task itself looked
# perfectly healthy. Drive itself only runs in the user's session too, so there
# is no principal that both has admin rights and can reach the folder: it has
# to be the user.
$backupPrincipal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited

$backupSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

if (Get-ScheduledTask -TaskName "UncannedWhatsAppBackup" -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName "UncannedWhatsAppBackup" -Confirm:$false
}

Register-ScheduledTask -TaskName "UncannedWhatsAppBackup" `
    -Action $backupAction -Trigger $backupTrigger `
    -Principal $backupPrincipal -Settings $backupSettings `
    -Description "Daily database backup for Uncanned WhatsApp." | Out-Null

Write-Host "      Backup: daily at 2:30am (as $env:USERNAME)." -ForegroundColor Green
Write-Host "        Runs while you are signed in - Google Drive only exists" -ForegroundColor DarkGray
Write-Host "        inside your session. A run missed overnight is taken at" -ForegroundColor DarkGray
Write-Host "        the next sign-in, and /api/health reports it after 30h." -ForegroundColor DarkGray

# Taken now as well, so there is a copy from this moment rather than one
# starting tomorrow.
$backupDir = Join-Path $AppRoot "backups"
$existing = @(Get-ChildItem $backupDir -Filter "*.zip" -ErrorAction SilentlyContinue)

if ($existing.Count -eq 0) {
    Write-Host "      No backup exists yet - taking one now..." -ForegroundColor Yellow
    & powershell -ExecutionPolicy Bypass -File (Join-Path $AppRoot "deploy\backup.ps1") | Out-Null
}

$newest = Get-ChildItem $backupDir -Filter "*.zip" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($newest) {
    $age = [math]::Round(((Get-Date) - $newest.LastWriteTime).TotalHours, 1)
    Write-Host "      Newest backup is $age hours old."
} else {
    Write-Host "      WARNING: still no backup. Run deploy\backup.ps1 by hand." -ForegroundColor Red
}

# --- 4. Tunnel ------------------------------------------------------------

Write-Host ""
Write-Host "[4/5] Internet tunnel" -ForegroundColor Cyan

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
Write-Host "[5/5] Checking it answers" -ForegroundColor Cyan

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
