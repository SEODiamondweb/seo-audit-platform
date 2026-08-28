@echo off
REM Arresta il bot avviato dall'attivita' pianificata.
REM
REM Serve uno script apposta perche' il lanciatore avvia node e termina subito: per Windows
REM l'attivita' e' gia' conclusa mentre il bot continua a girare, quindi "Termina attivita'"
REM nell'Utilita' di pianificazione non lo fermerebbe.
REM
REM Il PID da terminare e' quello del supervisore, scritto nel lock: si evita cosi' di
REM chiudere altri programmi Node eventualmente in esecuzione.

cd /d "%~dp0.."

if not exist "data\bot.pid" (
  echo Nessun lock trovato: il bot non risulta in esecuzione.
  exit /b 0
)

set "PID="
for /f "usebackq delims=" %%p in ("data\bot.pid") do set "PID=%%p"

if "%PID%"=="" (
  echo Lock vuoto: nulla da fermare.
  del "data\bot.pid" 2>nul
  exit /b 0
)

REM /T termina anche il processo figlio del bot.
taskkill /PID %PID% /T /F >nul 2>&1

if errorlevel 1 (
  echo Il processo %PID% non era piu' attivo. Lock rimosso.
) else (
  echo Bot arrestato ^(PID %PID%^).
)

del "data\bot.pid" 2>nul
exit /b 0
