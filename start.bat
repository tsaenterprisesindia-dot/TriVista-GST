@echo off
REM ============================================================
REM  TriVista GST - Start the app
REM  Runs the server and opens the browser.
REM  On a fresh machine, run setup.bat first.
REM ============================================================
setlocal
cd /d "%~dp0backend"

echo Starting TriVista GST on http://localhost:5000 ...
echo Close this window with Ctrl+C to stop the app.

REM open the browser after the server is up
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:5000"

node src/server.js

echo.
echo App stopped.
pause