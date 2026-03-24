@echo off
setlocal

set "ROOT=%~dp0"
set "LOCAL_CLOUDFLARED=%ROOT%tools\cloudflared\cloudflared.exe"

if exist "%LOCAL_CLOUDFLARED%" (
  set "CLOUDFLARED_CMD=%LOCAL_CLOUDFLARED%"
) else (
  where cloudflared >nul 2>nul
  if errorlevel 1 (
    echo cloudflared is not installed and no local binary was found.
    echo Install it first, then run this script again.
    echo Docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    exit /b 1
  )
  set "CLOUDFLARED_CMD=cloudflared"
)

echo Building workspace for single-URL sharing...
call npm.cmd run build
if errorlevel 1 exit /b 1

echo Starting poker app on http://localhost:3001 ...
start "Poker App" cmd /k "cd /d "%ROOT%" && set WEB_DIST_PATH=%ROOT%packages\web\dist && npm.cmd run start:server"

echo Waiting for local server...
powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(30); do { try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3001/health | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } } while((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo Local server did not become ready on http://127.0.0.1:3001 within 30 seconds.
  echo Check the Poker App window for startup errors.
  exit /b 1
)

echo Starting Cloudflare Quick Tunnel...
start "Poker Tunnel" cmd /k ""%CLOUDFLARED_CMD%" tunnel --url http://localhost:3001"

echo.
echo The tunnel window will print a trycloudflare.com URL.
echo Share that single URL with other players.
