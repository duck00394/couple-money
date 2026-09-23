@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Couple Money - 啟動中

if not exist .env (
  echo [X] 還沒設定過，請先雙擊「1-第一次設定.bat」。
  echo.
  pause
  exit /b 1
)

echo ==================================================
echo   Couple Money 啟動中...
echo.
echo   等一下會自動打開瀏覽器。
echo   如果沒有自動打開，請自己開瀏覽器輸入：
echo   http://localhost:3000
echo.
echo   要關掉 App：在這個視窗按 Ctrl + C，或直接關掉視窗。
echo ==================================================
echo.

start "" /min cmd /c "timeout /t 12 >nul & start http://localhost:3000"
call npm run dev

echo.
echo App 已停止。
pause
