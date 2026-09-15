@echo off
rem ============================================================
rem TriVista GST ERP - production start helper
rem Starts MariaDB (XAMPP) if needed, then the backend which
rem serves the API + built frontend + public pay pages on :5000
rem ============================================================
title TriVista GST ERP - Start
setlocal

echo [1/4] Checking MariaDB (XAMPP) on port 3306...
netstat -ano | findstr /C:":3306" >nul 2>&1
if errorlevel 1 (
  if exist "H:\xampp\xampp-control.exe" start "" "H:\xampp\xampp-control.exe"
  echo   MariaDB not running - started XAMPP control panel. Waiting up to 30s...
  for /l %%i in (1,1,30) do (
    timeout /t 1 /nobreak >nul
    netstat -ano | findstr /C:":3306" >nul 2>&1
    if not errorlevel 1 goto dbup
  )
  echo   MySQL did not start. Start it from the XAMPP control panel, then re-run this script.
  pause
  exit /b 1
)
:dbup
echo   OK.

echo [2/4] Checking backend on port 5000...
netstat -ano | findstr /C:":5000" >nul 2>&1
if errorlevel 1 (
  echo   Starting backend...
  start "TriVista backend" /min cmd /c "H:\TriveniGST\backend\start-prod.cmd"
) else (
  echo   Backend already running.
)

echo [3/4] Waiting for backend to accept connections...
for /l %%i in (1,1,15) do (
  timeout /t 1 /nobreak >nul
  netstat -ano | findstr /C:":5000" >nul 2>&1
  if not errorlevel 1 goto apiup
)
echo   Backend did not come up. See %TEMP%\opencode\prod_err.log
pause
exit /b 1

:apiup
echo [4/4] OK.

echo.
echo   TriVista GST ERP is live:
echo     Production (single port): http://localhost:5000
echo     Health check:             http://localhost:5000/api/health
echo     Frontend dev server:      http://localhost:5173  (only if you started it)
echo.
pause