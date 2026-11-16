@echo off
title Alerta de Precos - WhatsApp Bot
cd /d "%~dp0"
echo Iniciando Alerta de Precos (modo leve)...
echo Para encerrar, feche esta janela ou pressione Ctrl+C.
echo.
if not exist "node_modules" (
  echo Instalando dependencias pela primeira vez...
  call npm install
)
npm start
pause
