@echo off
rem ============================================================
rem  Restores the UI files from the last state marked as stable.
rem  Double-click this to roll the UI back.
rem  Overwrites web/static and web/app.py with the "ui-stable" version.
rem  Mark a new stable point first with mark-ui-stable.bat
rem ============================================================
cd /d "%~dp0.."

if not exist ".git" (
    echo This must run inside the AI Agents repository.
    pause
    exit /b 1
)

git rev-parse ui-stable >nul 2>&1
if errorlevel 1 (
    echo No "ui-stable" marker found. Run mark-ui-stable.bat first.
    pause
    exit /b 1
)

git checkout ui-stable -- web/static web/app.py
echo.
echo UI restored to the last stable version (tag: ui-stable).
echo Restart uvicorn if web/app.py changed.
echo.
pause
