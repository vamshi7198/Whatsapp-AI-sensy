# Fills .env with cryptographically random secrets.
#
# Only replaces values that are still empty, so re-running never invalidates
# existing sessions or makes an already-stored Meta token undecryptable.
#
# Usage:  powershell -File deploy\generate-secrets.ps1

$envPath = Join-Path $PSScriptRoot "..\.env"

if (-not (Test-Path $envPath)) {
    Write-Error "No .env found. Run: Copy-Item .env.example .env"
    exit 1
}

# RandomNumberGenerator.Create() works on both Windows PowerShell 5.1 and
# PowerShell 7; the newer static Fill() does not exist on 5.1.
function New-RandomBytes {
    param([int]$Count = 32)
    $bytes = New-Object byte[] $Count
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return $bytes
}

function New-Base64Key {
    return [Convert]::ToBase64String((New-RandomBytes 32))
}

function New-HexToken {
    return ((New-RandomBytes 32) | ForEach-Object { $_.ToString("x2") }) -join ""
}

$content = Get-Content $envPath -Raw
$generated = @()

$targets = @(
    @{ Key = "AUTH_SECRET";               Value = (New-Base64Key) },
    @{ Key = "APP_ENCRYPTION_KEY";        Value = (New-Base64Key) },
    @{ Key = "META_WEBHOOK_VERIFY_TOKEN"; Value = (New-HexToken)  },
    @{ Key = "SEED_ADMIN_PASSWORD";       Value = (New-Base64Key) }
)

foreach ($t in $targets) {
    $empty = "$($t.Key)=`"`""
    if ($content.Contains($empty)) {
        $content = $content.Replace($empty, "$($t.Key)=`"$($t.Value)`"")
        $generated += $t.Key
    } else {
        Write-Host "  = $($t.Key) already set, left unchanged"
    }
}

Set-Content -Path $envPath -Value $content -Encoding utf8 -NoNewline

if ($generated.Count -gt 0) {
    Write-Host ""
    Write-Host "Generated: $($generated -join ', ')" -ForegroundColor Green
}

Write-Host ""
Write-Host "IMPORTANT: back up APP_ENCRYPTION_KEY somewhere safe." -ForegroundColor Yellow
Write-Host "It decrypts your stored Meta access token. Lose it and the token"
Write-Host "must be entered again."
Write-Host ""
Write-Host "Still to set by hand in .env:"
Write-Host "  APP_URL           https://whatsapp.yourdomain.com"
Write-Host "  NODE_ENV          production"
Write-Host "  META_APP_ID       from your Meta app -> Settings -> Basic"
Write-Host "  META_APP_SECRET   same page (needed to verify incoming messages)"
