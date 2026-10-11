@echo off
rem Double-click: get the newest Schedule Helper.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1"
pause
