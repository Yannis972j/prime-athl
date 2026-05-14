@echo off
title Muscu - Serveur local
cd /d "%~dp0"
echo.
echo ============================================
echo   Muscu - Serveur local
echo ============================================
echo.
echo   PC ........... http://10.141.203.38:8000/
echo   Tel.  scanne qr.html
echo.
echo   (Ctrl+C pour arreter)
echo ============================================
echo.
node serve.js
pause
