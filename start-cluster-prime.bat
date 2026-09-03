@echo off
setlocal
if exist "config\api-keys.env" for /f "usebackq tokens=1,* delims==" %%A in ("config\api-keys.env") do (
  if "%%A"=="MAX_CLUSTER_SECRET" set "MAX_CLUSTER_SECRET=%%B"
  if "%%A"=="MAX_CLUSTER_WORKERS" set "MAX_CLUSTER_WORKERS=%%B"
)
if "%MAX_CLUSTER_SECRET%"=="" (
  echo ERROR: Set MAX_CLUSTER_SECRET to the same long random value on both computers.
  exit /b 1
)
if "%MAX_CLUSTER_WORKERS%"=="" (
  echo ERROR: Set MAX_CLUSTER_WORKERS, for example machine_b=http://192.168.1.250:3100
  exit /b 1
)
set MAX_CLUSTER_ROLE=coordinator
if "%MAX_NODE_ID%"=="" set MAX_NODE_ID=max-prime
node launcher.mjs --mode chat --cluster-role coordinator --node-id %MAX_NODE_ID%
