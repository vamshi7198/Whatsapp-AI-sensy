@echo off
REM Double-click this when whatsapp.uncanned.in will not load.
REM
REM Checks the database, the app and the internet tunnel, starts whatever is
REM stopped, and makes sure all three come back on their own after a restart.
REM Safe to run at any time.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Asking for Administrator permission...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "C:\dev\uncanned-whatsapp"
if %errorlevel% neq 0 (
    echo.
    echo Could not find C:\dev\uncanned-whatsapp
    echo If the app has moved, edit the folder name in this file.
    echo.
    pause
    exit /b 1
)

powershell -ExecutionPolicy Bypass -File "deploy\repair.ps1"

echo.
echo Press any key to close this window.
pause >nul
