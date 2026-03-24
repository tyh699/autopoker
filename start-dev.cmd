@echo off
setlocal

set "ROOT=%~dp0"

echo Starting poker server...
start "Poker Server" cmd /k "cd /d "%ROOT%" && npm.cmd run dev:server"

echo Starting poker web...
start "Poker Web" cmd /k "cd /d "%ROOT%" && npm.cmd run dev:web"

echo.
echo Dev server windows launched.
echo Web: http://localhost:5173
echo API: http://localhost:3001

