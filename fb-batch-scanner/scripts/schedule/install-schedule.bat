@echo off
:: Double-click to INSTALL daily schedule (Windows)
:: Uses Windows Task Scheduler (schtasks).
::
:: Default time: 08:00 daily. Edit SCHEDULE_TIME below to change.

setlocal enabledelayedexpansion

:: ╔══════════════════════════════════════════╗
:: ║  EDIT THIS TO CHANGE RUN TIME (24h HH:MM)║
:: ╠══════════════════════════════════════════╣
set "SCHEDULE_TIME=08:00"
:: ╚══════════════════════════════════════════╝

set "TASK_NAME=QingFbScanDaily"
set "SCRIPT_DIR=%~dp0"
:: Resolve PROJECT_DIR = SCRIPT_DIR\..\..
pushd "%SCRIPT_DIR%..\.."
set "PROJECT_DIR=%CD%"
popd

echo ╔══════════════════════════════════════════════════════════════════╗
echo ║  fb-batch-scanner — Daily Schedule Installer (Windows)           ║
echo ╚══════════════════════════════════════════════════════════════════╝
echo   Project: %PROJECT_DIR%
echo   Run time: %SCHEDULE_TIME% daily
echo.

:: Find node.exe
where node >nul 2>&1
if errorlevel 1 (
  echo X ERROR: 'node' not found in PATH. Install Node.js first.
  pause
  exit /b 1
)
for /f "tokens=*" %%i in ('where node') do set "NODE_BIN=%%i" & goto :node_found
:node_found
echo   Node: %NODE_BIN%
echo.

:: ─── Bootstrap: install npm deps + Chromium (so scheduled runs work) ─
if not exist "%PROJECT_DIR%\node_modules\playwright" (
  echo   Running 'npm install' (first time, ~30s)...
  cd /d "%PROJECT_DIR%"
  call npm install
  if errorlevel 1 (
    echo X npm install failed
    pause
    exit /b 1
  )
  echo.
)
"%NODE_BIN%" -e "require('playwright').chromium.executablePath()" >nul 2>&1
if errorlevel 1 (
  echo   Downloading Playwright Chromium (first time, ~170MB)...
  cd /d "%PROJECT_DIR%"
  call npx playwright install chromium
  if errorlevel 1 (
    echo X playwright install failed
    pause
    exit /b 1
  )
  echo.
)

:: Remove existing task if present (idempotent)
schtasks /Query /TN "%TASK_NAME%" >nul 2>&1
if not errorlevel 1 (
  echo   Removing previous schedule...
  schtasks /Delete /TN "%TASK_NAME%" /F >nul
)

:: The action: free port 3000 (in case held by stale process), then cd to project, run node run.js, append logs.
:: PowerShell handles port-kill cleaner than nested for/netstat inside schtasks.
set "KILL_PORT=powershell -NoProfile -Command \"Get-NetTCPConnection -LocalPort 3000 -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }\""
set "CMD=cmd /c %KILL_PORT% ^& cd /d \"%PROJECT_DIR%\" ^&^& \"%NODE_BIN%\" run.js >> \"%PROJECT_DIR%\logs\sched.out\" 2>> \"%PROJECT_DIR%\logs\sched.err\""

:: Create logs dir
if not exist "%PROJECT_DIR%\logs" mkdir "%PROJECT_DIR%\logs"

schtasks /Create /TN "%TASK_NAME%" /TR "%CMD%" /SC DAILY /ST %SCHEDULE_TIME% /F /RL HIGHEST
if errorlevel 1 (
  echo X Failed to create task.
  pause
  exit /b 1
)

echo.
echo ╔══════════════════════════════════════════════════════════════════╗
echo ║  ✓ INSTALLED                                                     ║
echo ║  Task: %TASK_NAME%                                       ║
echo ║  Next run: %SCHEDULE_TIME% daily                                          ║
echo ║  Test now: schtasks /Run /TN "%TASK_NAME%"             ║
echo ║  Uninstall: double-click uninstall-schedule.bat                  ║
echo ╚══════════════════════════════════════════════════════════════════╝
echo.
echo Status:
schtasks /Query /TN "%TASK_NAME%" /V /FO LIST | findstr /R "TaskName Status NextRun"
echo.
pause
