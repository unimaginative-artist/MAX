@echo off
echo ===============================================================================
echo   SOMA ULTRA - PRODUCTION STARTUP (POSEIDON POWERED)
echo ===============================================================================
echo.
echo   [1] Setting Environment to PRODUCTION...
set NODE_ENV=production
set SOMA_MODE=cluster
set SOMA_GPU=true
set SOMA_LOAD_HEAVY=true
set SOMA_LOAD_TRADING=true
set SOMA_HYBRID_SEARCH=true
set SOMA_LOAD_VISION=true

echo   [2] Checking for dependencies...
if not exist "node_modules" (
    echo       Node modules not found. Installing...
    npm install
)

echo   [2.5] Starting Project Siren (Local Lungs)...
start /B "" "C:\Users\barry\Desktop\SOMA\siren-bridge\.venv\Scripts\python.exe" "C:\Users\barry\Desktop\SOMA\siren-bridge\siren_bridge.py"
echo       - Waiting for GPU warm-up...
timeout /t 10 /nobreak > nul

echo   [3] Starting SOMA ULTRA...
echo       - Backend: Enabled
echo       - Frontend: Serving from /dist
echo       - GPU Acceleration: Enabled
echo       - Auto-Training: Enabled
echo       - Vocal Engine: Siren (Local CUDA)
echo.
echo   Access the dashboard at: http://localhost:3001
echo.

node --max-old-space-size=4096 launcher_ULTRA.mjs
pause
