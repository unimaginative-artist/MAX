@echo off
setlocal
echo =======================================================
echo   MAX-CODER v2 FINE-TUNING PIPELINE (Unsloth QLoRA)
echo =======================================================
echo.

echo 1. Compiling 3-tier High-IQ, SOMA, and DPO dataset...
node tools/compile_sovereign_dataset.mjs
if %errorlevel% neq 0 (
    echo [ERROR] Dataset compilation failed!
    exit /b 1
)

echo.
echo 2. Checking Python environment for Unsloth...
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python not found in PATH!
    exit /b 1
)

echo.
echo 3. Launching Unsloth training script...
python finetune_unsloth.py
if %errorlevel% neq 0 (
    echo [ERROR] Fine-tuning encountered an error.
    exit /b 1
)

echo.
echo =======================================================
echo   Training Complete! Exported to local Ollama / GGUF
echo =======================================================
