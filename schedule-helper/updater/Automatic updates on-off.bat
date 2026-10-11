@echo off
rem Double-click once: checks for a new Schedule Helper every hour by itself (no window). Run it again to switch it off.
schtasks /Query /TN "Schedule Helper update" >nul 2>&1
if %errorlevel%==0 (
  schtasks /Delete /TN "Schedule Helper update" /F >nul
  echo Automatic updates are now OFF.
) else (
  schtasks /Create /TN "Schedule Helper update" /SC HOURLY /TR "wscript.exe \"%~dp0update-quiet.vbs\"" /F >nul
  echo Automatic updates are now ON: it checks every hour.
  wscript.exe "%~dp0update-quiet.vbs"
)
pause
