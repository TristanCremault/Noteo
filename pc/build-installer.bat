@echo off
REM ============================================================
REM  Noteo : fabrique l'installateur (Inno Setup)
REM    1) npm run pack  -> dist\win-unpacked  (application prete a l'emploi)
REM    2) ISCC          -> installer\Output\Noteo-Installateur-X.Y.Z.exe
REM  Prerequis : Inno Setup 6 (https://jrsoftware.org/isdl.php)
REM ============================================================
setlocal
cd /d "%~dp0"

for /f %%v in ('node -p "require('./package.json').version"') do set VER=%%v

echo.
echo === 1/2  Preparation de l'application (electron-builder) ===
call npm run pack
if errorlevel 1 (
  echo.
  echo ECHEC de "npm run pack". Regarde le message ci-dessus.
  pause
  exit /b 1
)

set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"

if not defined ISCC (
  echo.
  echo Inno Setup 6 est introuvable. Installe-le puis relance ce fichier :
  echo https://jrsoftware.org/isdl.php
  pause
  exit /b 1
)

echo.
echo === 2/2  Creation de l'installateur (version %VER%) ===
"%ISCC%" /DAppVersion=%VER% "installer\Noteo.iss"
if errorlevel 1 (
  echo.
  echo ECHEC d'Inno Setup. Copie-moi le message d'erreur ci-dessus.
  pause
  exit /b 1
)

echo.
echo Termine : installer\Output\Noteo-Installateur-%VER%.exe
explorer "installer\Output"
pause
