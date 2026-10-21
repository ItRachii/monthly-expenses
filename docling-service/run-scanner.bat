@echo off
rem Updates, builds and starts Ledger's scanner one step at a time, stopping
rem at the first step that fails, then opens it to the app with ngrok.
rem Double-click it, or run .\run-scanner.bat from PowerShell or Command
rem Prompt. It works from any folder.
setlocal

rem git pull can rewrite this very file, and Windows reads a running batch
rem file as it goes: run from a copy, so an update cannot break this run.
if /i not "%~1"=="--from-copy" (
  copy /y "%~f0" "%TEMP%\ledger-run-scanner.bat" >nul
  "%TEMP%\ledger-run-scanner.bat" --from-copy "%~dp0"
)
set "HERE=%~2"
set "PULLED=%~3"
cd /d "%HERE%"

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
echo [1/6] Getting the latest code: git pull
if /i "%PULLED%"=="pulled" (
  echo       Done already, before this script restarted on its updated version.
  goto build
)
where git >nul 2>&1
if errorlevel 1 (
  echo       Git is not installed or not on PATH, so the code already here is built.
  goto build
)
set "BEFORE="
set "AFTER="
for /f %%h in ('git -C "%HERE%.." rev-parse HEAD 2^>nul') do set "BEFORE=%%h"
git -C "%HERE%.." pull --ff-only
if errorlevel 1 (
  echo       Could not update ^(no internet, or files changed here by hand^). Building the code already here.
  goto build
)
rem The update changed this script: carry on with the new one.
for /f %%h in ('git -C "%HERE%.." rev-parse HEAD 2^>nul') do set "AFTER=%%h"
if "%BEFORE%"=="%AFTER%" goto build
git -C "%HERE%.." diff --quiet %BEFORE% %AFTER% -- docling-service/run-scanner.bat
if errorlevel 1 (
  echo       This script was updated too. Restarting it.
  copy /y "%HERE%run-scanner.bat" "%TEMP%\ledger-run-scanner-new.bat" >nul
  "%TEMP%\ledger-run-scanner-new.bat" --from-copy "%HERE%" pulled
)

:build
echo.
echo [2/6] Building the image: docker compose build
echo       The build also runs the strike check's tests and a sample scan. The first
echo       build takes a while, and a step can sit with no new output. Leave it running.
docker compose build
if errorlevel 1 (
  echo The build failed. Copy the last 20 lines above.
  goto fail
)

echo.
echo [3/6] Checking the image: docker images ledger-scanner
docker images ledger-scanner
docker image inspect ledger-scanner >nul 2>&1
if errorlevel 1 (
  echo The build finished but no ledger-scanner image was saved.
  goto fail
)

echo.
echo [4/6] Starting the scanner: docker compose up -d
echo       A newly built image replaces the running scanner.
docker compose up -d
if errorlevel 1 (
  echo The scanner did not start. See: docker compose logs scanner
  goto fail
)
call :wait
if errorlevel 2 goto broken
if errorlevel 1 goto slow

echo.
echo [5/6] Checking the running scanner has the strike check
docker compose exec -T scanner python -c "import strike" >nul 2>&1
if not errorlevel 1 goto checked
echo       It is still the older scanner. Replacing it: docker compose up -d --force-recreate
docker compose up -d --force-recreate
if errorlevel 1 (
  echo The scanner did not start. See: docker compose logs scanner
  goto fail
)
call :wait
if errorlevel 2 goto broken
if errorlevel 1 goto slow
docker compose exec -T scanner python -c "import strike" >nul 2>&1
if errorlevel 1 (
  echo The running scanner still has no strike check. Copy the build output above.
  goto fail
)
:checked
echo       Strike check installed. Scanner is ready: http://127.0.0.1:8787/health shows {"ok":true}

echo.
echo [6/6] Opening it to the app with ngrok
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
rem An ngrok window left open from an earlier run still serves this address
rem (it points at port 8787, which the new scanner uses): keep it, since a
rem second one for the same address is refused. Other ngrok windows, like
rem n8n's, are left alone.
rem Each ngrok window answers on a local port from 4040 up; ngrok lists its
rem addresses in lower case.
set "OPEN="
set "TUNNELS=%TEMP%\ledger-ngrok-tunnels.json"
if exist "%TUNNELS%" del "%TUNNELS%"
for %%p in (4040 4041 4042 4043 4044 4045) do curl -s -m 2 http://127.0.0.1:%%p/api/tunnels >> "%TUNNELS%" 2>nul
if exist "%TUNNELS%" find "%NGROK_URL%" "%TUNNELS%" >nul 2>&1
if exist "%TUNNELS%" if not errorlevel 1 set "OPEN=yes"
if defined OPEN (
  echo ngrok is already open for this address ^(its window from an earlier run^): leaving it running.
  goto done
)
start "ngrok scanner" cmd /k ngrok http %NGROK_AUTH% --url=%NGROK_URL% 8787

:done
echo Keep the ngrok window open: closing it takes the scanner offline for the app.

:finish
echo.
pause
exit /b 0

:slow
echo Still not ready after 3 minutes. Last log lines:
docker compose logs --tail 20 scanner
goto fail

:broken
echo The scanner stopped or is failing its health check. Last log lines:
docker compose logs --tail 20 scanner
goto fail

:fail
echo.
pause
exit /b 1

rem Waits for the scanner to load its models: 0 healthy, 1 still loading
rem after 3 minutes, 2 stopped or failing.
:wait
echo       Waiting for the scanner to load its models (up to 3 minutes)...
set /a WAITED=0
:wait_again
set "STATE="
set "HEALTH="
for /f "tokens=1,2" %%a in ('docker inspect --format "{{.State.Status}} {{.State.Health.Status}}" ledger-scanner 2^>nul') do (
  set "STATE=%%a"
  set "HEALTH=%%b"
)
if "%HEALTH%"=="healthy" exit /b 0
if "%HEALTH%"=="unhealthy" exit /b 2
if "%STATE%"=="exited" exit /b 2
if "%STATE%"=="restarting" exit /b 2
set /a WAITED+=1
if %WAITED% geq 36 exit /b 1
ping -n 6 127.0.0.1 >nul
goto wait_again
