@echo off
rem Builds and starts Ledger's scanner one step at a time, stopping at the
rem first step that fails, then opens it to the app with ngrok. Double-click it, or run .\run-scanner.bat from
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
echo [1/4] Building the image: docker compose build
echo       The first build takes a while, and a step can sit with no new output. Leave it running.
docker compose build
if errorlevel 1 (
  echo The build failed. Copy the last 20 lines above.
  goto fail
)

echo.
echo [2/4] Checking the image: docker images ledger-scanner
docker images ledger-scanner
docker image inspect ledger-scanner >nul 2>&1
if errorlevel 1 (
  echo The build finished but no ledger-scanner image was saved.
  goto fail
)

echo.
echo [3/4] Starting the scanner: docker compose up -d
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

echo.
echo [4/4] Opening it to the app with ngrok in a new window
where ngrok >nul 2>&1
if errorlevel 1 (
  echo ngrok is not installed or not on PATH. Install it from https://ngrok.com/download then run: ngrok http 8787
  goto finish
)
rem NGROK_URL in .env is your static ngrok domain, so the address Vercel
rem uses stays the same on every start. NGROK_AUTHTOKEN, if set, logs this
rem ngrok in with a different account from the one n8n uses.
set "NGROK_URL="
set "NGROK_AUTHTOKEN="
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
  if /i "%%a"=="NGROK_URL" set "NGROK_URL=%%b"
  if /i "%%a"=="NGROK_AUTHTOKEN" set "NGROK_AUTHTOKEN=%%b"
)
set "NGROK_AUTH="
if defined NGROK_AUTHTOKEN set "NGROK_AUTH=--authtoken %NGROK_AUTHTOKEN%"
if defined NGROK_AUTHTOKEN echo Using the ngrok account from NGROK_AUTHTOKEN in .env
if not defined NGROK_AUTHTOKEN echo No NGROK_AUTHTOKEN in .env, so ngrok uses the account in its default config
if defined NGROK_URL set "NGROK_URL=%NGROK_URL:https://=%"
if defined NGROK_URL goto static
echo No NGROK_URL in .env, so ngrok picks a new random address each time.
echo Copy the https address from the ngrok window into Vercel as DOCLING_URL, every time.
start "ngrok scanner" cmd /k ngrok http %NGROK_AUTH% 8787
goto done

:static
echo Address for Vercel DOCLING_URL: https://%NGROK_URL%
start "ngrok scanner" cmd /k ngrok http %NGROK_AUTH% --url=%NGROK_URL% 8787

:done
echo Keep the ngrok window open: closing it takes the scanner offline for the app.

:finish
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
