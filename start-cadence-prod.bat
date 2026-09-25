@echo off
REM Double-click to run Cadence in PRODUCTION (build + start + worker, supervised).
title Cadence (production)
cd /d "%~dp0"
npm run start:all
pause
