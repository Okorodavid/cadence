@echo off
REM Double-click to start Cadence: app + job worker, then open the browser.
title Cadence
cd /d "%~dp0"
npm run dev:all -- --open
pause
