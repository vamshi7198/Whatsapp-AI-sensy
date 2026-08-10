@echo off
REM Double-click this to update the app. Nothing to type.
REM
REM It handles the two things that are easy to get wrong by hand:
REM asking for Administrator, and running from the project folder
REM rather than wherever the window happened to open.

REM Are we Administrator already? If not, restart this file as Administrator.
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

powershell -ExecutionPolicy Bypass -File "deploy\update.ps1"

echo.
echo Press any key to close this window.
pause >nul
