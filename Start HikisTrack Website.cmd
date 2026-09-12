@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the local website server.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4173"
node "%~dp0serve.cjs" "%~dp0" 4173
pause
