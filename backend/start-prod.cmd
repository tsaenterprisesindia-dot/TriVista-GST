@echo off
cd /d I:\TriveniGST\backend
node src/server.js >> "%TEMP%\opencode\prod_out.log" 2>> "%TEMP%\opencode\prod_err.log"