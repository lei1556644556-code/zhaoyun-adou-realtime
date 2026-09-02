@echo off
setlocal
cd /d "%~dp0"

call :CHECK_SERVER
if not errorlevel 1 goto OPEN_GAME

where pnpm >nul 2>nul
if not errorlevel 1 goto START_SERVER
echo [ERROR] pnpm was not found. Install Node.js 24 and run: corepack enable
pause
exit /b 1

:START_SERVER
echo Starting the game client and room server...
start "Zhao Yun and A Dou server" cmd /k pnpm dev
powershell -NoProfile -ExecutionPolicy Bypass -Command "$limit=(Get-Date).AddSeconds(60); while ((Get-Date) -lt $limit) { try { $response=Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200 -and $response.Content -match 'adou-build') { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; exit 1"
if not errorlevel 1 goto OPEN_GAME
echo [ERROR] The game page was not ready after 60 seconds. Check the server window.
pause
exit /b 1

:OPEN_GAME
echo Game ready: http://localhost:5173
if /I "%~1"=="--check" exit /b 0
start "" "http://localhost:5173"
exit /b 0

:CHECK_SERVER
curl.exe --silent --fail --max-time 2 http://localhost:5173/ 2>nul | findstr /C:"adou-build" >nul
exit /b %errorlevel%
