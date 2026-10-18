@echo off
rem Starts Docling's own web page (docling-serve) on this laptop only, for
rem trying files by hand. Ledger does not use it. Double-click it, or run
rem .\docling-ui.bat. Stop it with: docker compose --profile ui stop docling-ui
setlocal
cd /d "%~dp0"

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker is not running. Open Docker Desktop, wait for "Engine running", then run this again.
  goto fail
)

echo Starting the Docling UI. The first start downloads about 4.4 GB.
docker compose --profile ui up -d docling-ui
if errorlevel 1 (
  echo The Docling UI did not start. See: docker compose --profile ui logs docling-ui
  goto fail
)

echo Waiting for it to be ready (up to 2 minutes)...
for /l %%i in (1,1,40) do (
  curl -sf -o nul http://127.0.0.1:5001/health && goto ready
  ping -n 4 127.0.0.1 >nul
)
echo Still not ready after 2 minutes. Last log lines:
docker compose --profile ui logs --tail 20 docling-ui
goto fail

:ready
echo.
echo Docling UI is ready: http://127.0.0.1:5001/ui
start "" http://127.0.0.1:5001/ui
echo When you are done: docker compose --profile ui stop docling-ui
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
