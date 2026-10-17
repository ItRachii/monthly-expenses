@echo off
rem Builds and starts Ledger's scanner one step at a time, stopping at the
rem first step that fails. Double-click it, or run .\run-scanner.bat from
rem PowerShell or Command Prompt. It works from any folder.
setlocal
cd /d "%~dp0"

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker is not running. Open Docker Desktop, wait for "Engine running", then run this again.
  goto fail
)
if not exist .env (
  echo .env is missing. Create it from .env.example with a DOCLING_SECRET first, see README.md.
  goto fail
)

echo.
echo [1/3] Building the image: docker compose build
echo       The first build takes a while, and a step can sit with no new output. Leave it running.
docker compose build
if errorlevel 1 (
  echo The build failed. Copy the last 20 lines above.
  goto fail
)

echo.
echo [2/3] Checking the image: docker images ledger-scanner
docker images ledger-scanner
docker image inspect ledger-scanner >nul 2>&1
if errorlevel 1 (
  echo The build finished but no ledger-scanner image was saved.
  goto fail
)

echo.
echo [3/3] Starting the scanner: docker compose up -d
docker compose up -d
if errorlevel 1 (
  echo The scanner did not start. See: docker compose logs scanner
  goto fail
)

echo.
echo Waiting for the scanner to load its models (up to 3 minutes)...
for /l %%i in (1,1,36) do (
  for /f "tokens=1,2" %%a in ('docker inspect --format "{{.State.Status}} {{.State.Health.Status}}" ledger-scanner 2^>nul') do (
    if "%%b"=="healthy" goto ready
    if "%%b"=="unhealthy" goto broken
    if "%%a"=="exited" goto broken
    if "%%a"=="restarting" goto broken
  )
  ping -n 6 127.0.0.1 >nul
)
echo Still not ready after 3 minutes. Last log lines:
docker compose logs --tail 20 scanner
goto fail

:broken
echo The scanner stopped or is failing its health check. Last log lines:
docker compose logs --tail 20 scanner
goto fail

:ready
echo.
echo Scanner is ready: http://127.0.0.1:8787/health shows {"ok":true}
pause
exit /b 0

:fail
echo.
pause
exit /b 1
