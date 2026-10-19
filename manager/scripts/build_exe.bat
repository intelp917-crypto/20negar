@echo off
setlocal
cd /d "%~dp0.."

rem Build with the project environment so Qt, cryptography and PyInstaller match.
rem NOTE: PyInstaller rejects -i/--icon together with a .spec file, so this build
rem uses the plain command line (the icon must be passed here explicitly).
set "PY=.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

"%PY%" -m PyInstaller ^
  --clean ^
  --noconfirm ^
  --onefile ^
  --windowed ^
  --name 20negar-manager ^
  -i "scripts\20negar.ico" ^
  --add-data "scripts\icon-512.png;assets" ^
  main.py

if errorlevel 1 (
  echo Build failed. Run scripts\install.bat first.
  exit /b 1
)
echo Built dist\20negar-manager.exe
endlocal
