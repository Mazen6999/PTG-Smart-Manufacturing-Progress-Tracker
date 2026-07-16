@echo off
title Prometeon Progress Tracker Server (Close this window to stop server)
echo Starting local synchronization engine...
echo.

:: Open your web browser immediately at the localhost served URL
echo Launching Progress Tracker in browser...
start "" "http://localhost:8000"

:: Run the PowerShell HTTP Listener directly in this active console window
powershell.exe -ExecutionPolicy Bypass -File "%~dp0server.ps1"

exit
