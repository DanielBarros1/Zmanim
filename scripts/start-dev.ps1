#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Start the full Zmanim dev environment: Docker + Postgres + Server + Client.

.DESCRIPTION
  1. Kills stale Docker socket reparse points that block Docker Desktop startup.
  2. Ensures Docker Desktop is running and the postgres container is healthy.
  3. Starts the Express server (port 3001) and Vite dev server (port 5173)
     as hidden background processes, tailing output to server/dev.log and
     client/dev.log respectively.
#>

$root = "C:\Users\User\Zmanim"
$dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"

# ── 1. Clean stale Docker Unix-socket reparse points ────────────
# Docker Desktop crashes if it can't remove stale AF_UNIX socket files
# left over from abnormal shutdowns. Rotating the parent directories is
# the only reliable workaround on Windows (the files can't be deleted
# via normal Win32 APIs while in a "stuck" state).
function Rotate-IfStale {
    param([string]$Dir)
    if (-not (Test-Path $Dir)) { return }
    $sockets = Get-ChildItem $Dir -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint }
    if ($sockets) {
        $bak = $Dir + ".socketbak"
        Remove-Item $bak -Recurse -Force -ErrorAction SilentlyContinue
        Rename-Item $Dir $bak -ErrorAction SilentlyContinue
        New-Item -ItemType Directory $Dir -Force | Out-Null
        Write-Host "  Rotated stale sockets: $Dir" -ForegroundColor Yellow
    }
}

Write-Host "Cleaning stale Docker sockets..." -ForegroundColor Cyan
Rotate-IfStale "$env:LOCALAPPDATA\Docker\run"
Rotate-IfStale "$env:LOCALAPPDATA\docker-secrets-engine"
# Add more docker service directories here if new ones appear

# ── 2. Ensure Docker Desktop is running ─────────────────────────
$dockerRunning = (docker ps 2>$null; $LASTEXITCODE -eq 0)
if (-not $dockerRunning) {
    Write-Host "Starting Docker Desktop..." -ForegroundColor Cyan
    Start-Process -FilePath $dockerDesktop -PassThru | Out-Null

    $maxWait = 120; $elapsed = 0
    while ($elapsed -lt $maxWait) {
        Start-Sleep -Seconds 5; $elapsed += 5
        $r = docker ps 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  Docker ready after ${elapsed}s" -ForegroundColor Green; break
        }
        $be = Get-Process "com.docker.backend" -ErrorAction SilentlyContinue
        if (-not $be) {
            Write-Host "  Backend crashed — check Docker Desktop manually" -ForegroundColor Red; exit 1
        }
        Write-Host "  ...${elapsed}s"
    }
} else {
    Write-Host "Docker already running" -ForegroundColor Green
}

# ── 3. Ensure postgres container is up ──────────────────────────
$pgContainer = "personal-finance-app-postgres-1"
$pgStatus = docker inspect --format "{{.State.Status}}" $pgContainer 2>$null
if ($pgStatus -eq "running") {
    Write-Host "Postgres container already running" -ForegroundColor Green
} elseif ($pgStatus -eq "exited" -or $pgStatus -eq "created") {
    Write-Host "Starting postgres container..." -ForegroundColor Cyan
    docker start $pgContainer | Out-Null
    Start-Sleep -Seconds 3
    Write-Host "  Postgres started" -ForegroundColor Green
} else {
    Write-Host "  Postgres container '$pgContainer' not found — may need to create it" -ForegroundColor Red
}

# ── 4. Kill stale node processes ────────────────────────────────
Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# ── 5. Start server + client ────────────────────────────────────
"" | Out-File "$root\server\dev.log" -Encoding utf8
"" | Out-File "$root\client\dev.log" -Encoding utf8

Write-Host "Starting server..." -ForegroundColor Cyan
Start-Process -WindowStyle Hidden -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile", "-Command", "cd '$root\server'; npm run dev 2>&1 | Tee-Object -FilePath 'dev.log'" `
    -WorkingDirectory "$root\server"

Write-Host "Starting client..." -ForegroundColor Cyan
Start-Process -WindowStyle Hidden -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile", "-Command", "cd '$root\client'; npm run dev 2>&1 | Tee-Object -FilePath 'dev.log'" `
    -WorkingDirectory "$root\client"

# ── 6. Verify both came up ───────────────────────────────────────
Start-Sleep -Seconds 10
$serverOk = (Get-Content "$root\server\dev.log" -Raw) -like "*localhost:3001*"
$clientOk = (Get-Content "$root\client\dev.log" -Raw) -like "*localhost:5173*"

if ($serverOk) { Write-Host "Server:  http://localhost:3001  OK" -ForegroundColor Green }
else           { Write-Host "Server:  FAILED — check $root\server\dev.log" -ForegroundColor Red }

if ($clientOk) { Write-Host "Client:  http://localhost:5173  OK" -ForegroundColor Green }
else           { Write-Host "Client:  FAILED — check $root\client\dev.log" -ForegroundColor Red }
