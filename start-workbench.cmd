@echo off
setlocal
cd /d "%~dp0"
set "PORT=4310"
set "WORKBENCH_CONTAINER=0"
if not exist frontend\dist\index.html (
  call npm.cmd run build -w frontend
  if errorlevel 1 goto :failed
)
node scripts\start-local.cjs
if errorlevel 1 goto :failed
if /i not "%~1"=="--no-open" start "" "http://127.0.0.1:4310/"
exit /b 0
:failed
pause
exit /b 1
