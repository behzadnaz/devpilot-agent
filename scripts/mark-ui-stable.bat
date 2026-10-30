@echo off
rem ============================================================
rem  Marks the CURRENT state of the UI as the stable version.
rem  Double-click this whenever the UI is in a state you trust.
rem  - Commits any uncommitted changes first (so the marker is complete)
rem  - Moves the "ui-stable" tag to that commit
rem  Restore later with restore-ui.bat
rem ============================================================
cd /d "%~dp0.."

git add -A
git diff --cached --quiet
if %errorlevel%==0 (
    git tag -f ui-stable
    echo.
    echo UI marked as stable (nothing new to commit).
) else (
    git commit -m "Mark UI as stable" >nul
    git tag -f ui-stable
    echo.
    echo Changes committed and UI marked as stable.
)

echo.
pause
