@echo off
rem ============================================================
rem  Marks the CURRENT state of the UI as the stable version.
rem  Double-click this whenever the UI is in a state you trust.
rem
rem  Can also be called programmatically (used by the in-app
rem  checkpoint button):
rem      mark-ui-stable.bat "commit message" -q
rem  - -q            skips the pause, for automated runs
rem  - DEVPILOT_REPO overrides the repository folder (tests)
rem
rem  Restore later with restore-ui.bat
rem ============================================================
setlocal

if defined DEVPILOT_REPO (
    cd /d "%DEVPILOT_REPO%"
) else (
    cd /d "%~dp0.."
)

set "message=%~1"
if "%message%"=="" set "message=Mark UI as stable"
if "%message%"=="-q" set "message=Mark UI as stable"

set "quiet="
if "%~1"=="-q" set "quiet=1"
if "%~2"=="-q" set "quiet=1"

git add -A
git diff --cached --quiet
if %errorlevel%==0 (
    git tag -f ui-stable
    echo.
    echo UI marked as stable -- nothing new to commit.
) else (
    git commit -m "%message%" >nul
    git tag -f ui-stable
    echo.
    echo Changes committed and UI marked as stable.
)

echo.
if not defined quiet pause
