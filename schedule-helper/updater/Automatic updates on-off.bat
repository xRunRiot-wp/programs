@echo off
rem Double-click once: checks for a new Schedule Helper every 5 minutes by itself (no window). Run it again to switch it off.
schtasks /Query /TN "Schedule Helper update" >nul 2>&1
if %errorlevel%==0 (
  schtasks /Delete /TN "Schedule Helper update" /F >nul
  del "%~dp0.auto-every-5-min" >nul 2>&1
  echo Automatic updates are now OFF.
) else (
  schtasks /Create /TN "Schedule Helper update" /SC MINUTE /MO 5 /TR "wscript.exe \"%~dp0update-quiet.vbs\"" /F >nul
  echo on> "%~dp0.auto-every-5-min"
  echo Automatic updates are now ON: it checks every 5 minutes.
  wscript.exe "%~dp0update-quiet.vbs"
)
pause
