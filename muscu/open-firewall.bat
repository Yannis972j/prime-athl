@echo off
:: Clic-droit > "Executer en tant qu'administrateur"
:: Ouvre les ports 3001 (backend Prime Athl) et 8000 (legacy) dans le pare-feu

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ============================================
    echo   ERREUR : Droits admin requis
    echo ============================================
    echo   Clic-droit sur ce fichier puis
    echo   "Executer en tant qu'administrateur"
    echo ============================================
    pause
    exit /b 1
)

echo.
echo Ajout des regles pare-feu...
netsh advfirewall firewall delete rule name="Prime Athl Backend 3001" >nul 2>&1
netsh advfirewall firewall add rule name="Prime Athl Backend 3001" dir=in action=allow protocol=TCP localport=3001 profile=private,domain
netsh advfirewall firewall delete rule name="Muscu HTTP 8000" >nul 2>&1
netsh advfirewall firewall add rule name="Muscu HTTP 8000" dir=in action=allow protocol=TCP localport=8000 profile=private,domain
echo.
echo Termine. Ton tel peut maintenant scanner le QR.
pause
