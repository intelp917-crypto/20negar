@echo off
setlocal
cd /d "%~dp0.."
pyinstaller --clean --noconfirm manager.spec
endlocal
