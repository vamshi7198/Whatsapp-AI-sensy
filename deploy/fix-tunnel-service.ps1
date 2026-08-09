# Gives the Cloudflare tunnel service its configuration.
#
# `cloudflared service install` registers the service to run as LocalSystem
# with no --config argument, so it looks in SYSTEM's own profile rather than
# the profile of the person who created the tunnel. Without this copy the
# service starts, finds no tunnel to run, and the public address returns a
# Cloudflare 530 "origin not connected" error.
#
# Run as Administrator:
#   powershell -ExecutionPolicy Bypass -File deploy\fix-tunnel-service.ps1

#Requires -RunAsAdministrator

param(
    [string]$SourceProfile = "C:\Users\vamsh\.cloudflared",
    [string]$PublicUrl     = "https://whatsapp.uncanned.in/login"
)

$ErrorActionPreference = "Stop"
$SystemProfile = "C:\Windows\System32\config\systemprofile\.cloudflared"

Write-Host ""
Write-Host "Configuring the Cloudflare tunnel service" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $SourceProfile)) {
    Write-Error "No tunnel configuration found at $SourceProfile"
    exit 1
}

if (-not (Test-Path $SystemProfile)) {
    New-Item -ItemType Directory -Path $SystemProfile -Force | Out-Null
    Write-Host "  Created $SystemProfile"
}

# config.yml, the tunnel credentials .json, and cert.pem all need to be
# readable by the service account.
$copied = 0
foreach ($file in Get-ChildItem $SourceProfile -File) {
    Copy-Item $file.FullName $SystemProfile -Force
    Write-Host "  Copied $($file.Name)"
    $copied++
}

if ($copied -eq 0) {
    Write-Error "Nothing to copy from $SourceProfile"
    exit 1
}

Write-Host ""
Write-Host "Restarting the tunnel..." -ForegroundColor Cyan

# Restart-Service can hang indefinitely here: cloudflared holds its outbound
# connections open and does not always honour the stop signal. Stop the
# process directly instead of waiting on a graceful shutdown that may never
# come.
Stop-Service Cloudflared -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Start-Service Cloudflared
Start-Sleep -Seconds 10

Get-Service Cloudflared | Select-Object Name, Status | Format-Table -AutoSize

Write-Host "Testing the public address (this proves the internet can reach it)..."
Write-Host ""

$ok = $false
for ($i = 1; $i -le 6; $i++) {
    try {
        $response = Invoke-WebRequest -Uri $PublicUrl -UseBasicParsing -TimeoutSec 20
        if ($response.StatusCode -eq 200) {
            Write-Host "  SUCCESS - $PublicUrl is live" -ForegroundColor Green
            $ok = $true
            break
        }
    } catch {
        Write-Host "  attempt $i of 6 - not ready yet, waiting..."
        Start-Sleep -Seconds 10
    }
}

if (-not $ok) {
    Write-Host ""
    Write-Host "  Still not reachable." -ForegroundColor Yellow
    Write-Host "  Check the tunnel log with:"
    Write-Host '    Get-WinEvent -FilterHashtable @{LogName="Application"; ProviderName="cloudflared"} -MaxEvents 20 | Format-List TimeCreated, Message'
}

Write-Host ""
