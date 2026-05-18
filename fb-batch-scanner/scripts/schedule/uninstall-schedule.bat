@echo off
:: Double-click to UNINSTALL daily schedule (Windows)

setlocal
set "TASK_NAME=QingFbScanDaily"

echo ╔══════════════════════════════════════════════════════════════════╗
echo ║  fb-batch-scanner — Daily Schedule Uninstaller (Windows)         ║
echo ╚══════════════════════════════════════════════════════════════════╝
echo.

schtasks /Query /TN "%TASK_NAME%" >nul 2>&1
if errorlevel 1 (
  echo   (no scheduled task '%TASK_NAME%' found)
  echo.
  echo ╔══════════════════════════════════════════════════════════════════╗
  echo ║  Nothing to remove (was not installed)                           ║
  echo ╚══════════════════════════════════════════════════════════════════╝
) else (
  schtasks /Delete /TN "%TASK_NAME%" /F
  echo.
  echo ╔══════════════════════════════════════════════════════════════════╗
  echo ║  ✓ UNINSTALLED — daily schedule disabled                         ║
  echo ║  Manual run still works: node run.js                             ║
  echo ╚══════════════════════════════════════════════════════════════════╝
)
echo.
pause
