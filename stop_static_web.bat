@echo off
title Stop Progress Tracker Server
echo Stopping local background synchronization engine...
echo.

:: Call native PowerShell to read server.pid and stop that specific process
powershell.exe -Command "$scriptDir = '%~dp0'; $pidPath = Join-Path $scriptDir 'server.pid'; if (Test-Path $pidPath) { $pidToKill = Get-Content $pidPath; Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue; Remove-Item $pidPath -ErrorAction SilentlyContinue; Write-Host 'Local server successfully stopped.' } else { Write-Host 'No running server PID file found. Server is already offline.' }"

echo.
pause
exit
