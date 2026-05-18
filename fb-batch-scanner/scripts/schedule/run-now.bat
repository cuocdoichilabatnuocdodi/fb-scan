@echo off
:: Double-click to RUN BATCH NOW (Windows)
:: Same as: cd <project> && node run.js
:: Use to test schedule manually, or scan on-demand without waiting for daily fire.

setlocal
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%..\.."
set "PROJECT_DIR=%CD%"
popd

echo ╔══════════════════════════════════════════════════════════════════╗
echo ║  fb-batch-scanner — Run Now (Windows)                            ║
echo ╚══════════════════════════════════════════════════════════════════╝
echo   Project: %PROJECT_DIR%
echo.

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

:: ─── Bootstrap: install npm deps + Chromium if missing ─────────────
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

echo   Starting batch... (Ctrl+C to abort)
echo.

cd /d "%PROJECT_DIR%"
"%NODE_BIN%" run.js
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo ╔══════════════════════════════════════════════════════════════════╗
if "%EXIT_CODE%"=="0" (
  echo ║  ✓ DONE (exit 0)                                                 ║
) else (
  echo ║  X FAILED (exit %EXIT_CODE%)                                              ║
)
echo ║  Report: npm run report:today                                    ║
echo ╚══════════════════════════════════════════════════════════════════╝
echo.
pause
