@echo off
setlocal
chcp 65001 >nul
title Web Carta para Restaurante
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta Node.js. Instalalo desde https://nodejs.org y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo.
  echo  Falta el archivo .env: copia .env.example como .env y escribe ADMIN_PASSWORD.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo.
  echo  Primera vez: instalando lo necesario. Puede tardar unos minutos...
  echo.
  call npm install
  if errorlevel 1 goto :error
)

echo.
echo  Preparando la web...
echo.
call npm run -s build
if errorlevel 1 goto :error

echo.
echo  Carta:  http://localhost:4188
echo  Panel:  http://localhost:4188/superuser
echo.
echo  Deja esta ventana abierta. Para terminar, cierrala.
echo.
if not defined CARTA_SIN_NAVEGADOR start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & start "" http://localhost:4188/"
call npm run -s local
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo  No se ha podido arrancar. Lee el mensaje de arriba: dice que hay que corregir.
echo.
pause
exit /b 1
