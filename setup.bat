@echo off
REM ============================================================
REM  TriVista GST - Setup helper (run ONCE on a new machine)
REM  Installs backend dependencies, creates the database,
REM  and loads the clean masters for FY 2026-27.
REM ============================================================
setlocal
cd /d "%~dp0backend"

echo.
echo ===[ 1/3 ] Installing backend dependencies (needs internet, ~1-2 min) ===
call npm install
if errorlevel 1 (
  echo FAILED: npm install. Check your internet and Node.js install.
  pause
  exit /b 1
)

echo.
echo ===[ 2/3 ] Creating database schema ===
call npm run db:init
if errorlevel 1 (
  echo FAILED: database schema creation. Check MySQL is running and .env settings.
  pause
  exit /b 1
)

echo.
echo ===[ 3/3 ] Loading clean masters (company, GST rates, no demo data) ===
call npm run db:seed -- --clean

echo.
echo Setup complete. The app will now start - press any key.
pause >nul