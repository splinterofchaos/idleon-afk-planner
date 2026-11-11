@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo This app needs Node.js. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
start "Idleon AFK Planner" /min node server.js
