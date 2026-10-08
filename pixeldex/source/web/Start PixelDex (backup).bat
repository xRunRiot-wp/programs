@echo off
rem Backup way to start PixelDex if PixelDex.vbs is blocked on this PC.
cd /d "%~dp0"
start "" "runtime\pythonw.exe" "pixeldex.pyw"
