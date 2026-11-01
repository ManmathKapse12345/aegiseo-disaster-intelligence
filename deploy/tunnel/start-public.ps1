# Share AegisEO from this PC through a free Cloudflare quick tunnel (no account needed).
#
#   powershell -ExecutionPolicy Bypass -File deploy\tunnel\start-public.ps1 [-Rebuild] [-Auth]
#
# Builds the web UI (first run or -Rebuild), serves UI + API from the local backend on
# 127.0.0.1:8000 with the normal data directory, and opens a https://*.trycloudflare.com link.
# The link changes on every start (and if Cloudflare drops the tunnel, a new one opens
# automatically; the current link is always in data\public-url.txt). Ctrl+C stops both.
# -Auth turns on sign-in (tokens from AEGIS_API_TOKENS in .env); without it the site is open.
param([switch]$Rebuild, [switch]$Auth)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$py = Join-Path $root "backend\.venv\Scripts\python.exe"
$cloudflared = Join-Path $env:LOCALAPPDATA "cloudflared\cloudflared.exe"
if (-not (Test-Path $cloudflared)) { $cloudflared = (Get-Command cloudflared -ErrorAction Stop).Source }
$logs = Join-Path $root "data"
New-Item -ItemType Directory -Force $logs | Out-Null

if ($Rebuild -or -not (Test-Path (Join-Path $root "frontend\dist\index.html"))) {
    Write-Host "Building the web UI..."
    Push-Location (Join-Path $root "frontend")
    try { npm run build | Out-Host; if ($LASTEXITCODE) { throw "frontend build failed" } } finally { Pop-Location }
}

$busy = $false
try { Invoke-RestMethod http://127.0.0.1:8000/api/health -TimeoutSec 2 | Out-Null; $busy = $true } catch { }
if ($busy) { throw "Port 8000 is already in use - stop the other backend first." }

$env:AEGIS_AUTH_ENABLED = if ($Auth) { "true" } else { "false" }
# visitors' real IPs come from the tunnel's X-Forwarded-For (trusted from localhost only),
# so rate limits apply per visitor rather than to everyone at once
$api = Start-Process $py -ArgumentList "-m uvicorn aegis.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1" `
    -WorkingDirectory (Join-Path $root "backend") -RedirectStandardOutput "$logs\public-api.out.log" -RedirectStandardError "$logs\public-api.log" -PassThru -WindowStyle Hidden
$tunnel = $null
try {
    Write-Host "Starting the backend..."
    $ok = $false
    for ($i = 0; $i -lt 90 -and -not $ok; $i++) {
        Start-Sleep 1
        if ($api.HasExited) { throw "Backend exited - see data\public-api.log" }
        try { Invoke-RestMethod http://127.0.0.1:8000/api/health -TimeoutSec 2 | Out-Null; $ok = $true } catch { }
    }
    if (-not $ok) { throw "Backend did not start - see data\public-api.log" }

    $tlog = "$logs\public-tunnel.log"
    $urlFile = "$logs\public-url.txt"
    # Quick tunnels can be dropped by Cloudflare (cloudflared then retries a dead tunnel forever),
    # so a dead or deregistered tunnel is replaced by a new one - with a new link.
    while (-not $api.HasExited) {
        if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
        Write-Host "Opening the Cloudflare tunnel..."
        Remove-Item $tlog -ErrorAction SilentlyContinue
        $tunnel = Start-Process $cloudflared -ArgumentList "tunnel --no-autoupdate --url http://127.0.0.1:8000" `
            -RedirectStandardError $tlog -RedirectStandardOutput "$logs\public-tunnel.out.log" -PassThru -WindowStyle Hidden
        $url = $null
        for ($i = 0; $i -lt 60 -and -not $url -and -not $tunnel.HasExited; $i++) {
            Start-Sleep 1
            $m = Select-String -Path $tlog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($m) { $url = $m.Matches[0].Value }
        }
        if (-not $url) { Write-Warning "No tunnel link yet (see data\public-tunnel.log) - retrying in 30 s"; Start-Sleep 30; continue }

        Set-Content -Path $urlFile -Value $url
        Write-Host ""
        Write-Host "  AegisEO is public at:  $url   ($(Get-Date -Format 'HH:mm'))" -ForegroundColor Green
        Write-Host "  (sign-in required: $([bool]$Auth))  Keep this window open; press Ctrl+C to stop."
        Write-Host ""
        while (-not $api.HasExited -and -not $tunnel.HasExited) {
            Start-Sleep 5
            if (Select-String -Path $tlog -Pattern "Tunnel not found" -Quiet -ErrorAction SilentlyContinue) {
                Write-Warning "Cloudflare dropped the tunnel - opening a new one (the link will change)"
                break
            }
        }
    }
    Write-Warning "The backend exited - see data\public-api.log"
}
finally {
    foreach ($p in @($tunnel, $api)) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force } }
    Write-Host "Stopped."
}
