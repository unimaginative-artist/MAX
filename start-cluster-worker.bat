@echo off
setlocal
if exist "config\api-keys.env" for /f "usebackq tokens=1,* delims==" %%A in ("config\api-keys.env") do if "%%A"=="MAX_CLUSTER_SECRET" set "MAX_CLUSTER_SECRET=%%B"
if "%MAX_CLUSTER_SECRET%"=="" (
  echo ERROR: Set MAX_CLUSTER_SECRET to the same long random value used by Max Prime.
  exit /b 1
)
set MAX_CLUSTER_ROLE=worker
set MAX_WORKER_ALLOW_CLOUD=false
set MAX_EAGER_START=false
set MAX_DISCORD_ENABLED=true
set MAX_EXTERNAL_SEND=true
if "%MAX_NODE_ID%"=="" set MAX_NODE_ID=machine_b
node launcher.mjs --mode api --cluster-role worker --node-id %MAX_NODE_ID%
