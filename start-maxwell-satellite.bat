@echo off
title Maxwell Satellite - Sovereign Desktop Orb
echo ===============================================================================
echo   MAXWELL SATELLITE - Sovereign Desktop Orb
echo ===============================================================================
echo.

cd /d "%~dp0"

if "%MAX_SATELLITE_URL%"=="" (
    set "MAX_SATELLITE_URL=http://localhost:3100/satellite"
)

echo   Connecting to Maxwell Cluster at %MAX_SATELLITE_URL%...
echo   Launching Floating Desktop Orb...
echo.

cd /d "C:\Users\barry\Desktop\SOMA\a soma orb"
call npx electron electron/satellite-main.cjs
