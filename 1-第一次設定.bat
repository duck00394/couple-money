@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Couple Money - 第一次設定

echo ==================================================
echo   Couple Money  第一次設定
echo   （這個只需要跑一次，之後都用 2-啟動.bat）
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] 找不到 Node.js
  echo     請先到 https://nodejs.org 下載 LTS 版安裝，
  echo     裝完把這個視窗關掉，重新雙擊這個檔案。
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set NODEV=%%v
echo [OK] Node.js %NODEV%

where psql >nul 2>nul
if errorlevel 1 (
  echo [X] 找不到 psql（PostgreSQL 的指令）
  echo.
  echo     請把 PostgreSQL 的 bin 資料夾加到系統 PATH，通常是：
  echo     C:\Program Files\PostgreSQL\16\bin
  echo.
  echo     設定方式：Windows 搜尋「環境變數」-^> 編輯系統環境變數
  echo     -^> 環境變數 -^> Path -^> 新增上面那個路徑 -^> 全部按確定
  echo     然後關掉這個視窗，重新雙擊這個檔案。
  echo.
  pause
  exit /b 1
)
echo [OK] PostgreSQL 指令可以使用
echo.

set "PGUSERNAME="
set /p PGUSERNAME=PostgreSQL 使用者名稱（直接按 Enter 用 postgres）: 
if "%PGUSERNAME%"=="" set PGUSERNAME=postgres
set "PGPASSWORD="
set /p PGPASSWORD=PostgreSQL 密碼: 
echo.

echo [1/4] 建立試用用的資料庫 couple_money_demo ...
psql -U %PGUSERNAME% -d postgres -c "CREATE DATABASE couple_money_demo;" >nul 2>nul
if errorlevel 1 (
  echo       （資料庫已經存在或建立失敗，稍後如果連不上再檢查密碼）
) else (
  echo       完成
)

echo [2/4] 寫入連線設定 .env ...
> .env echo DATABASE_URL="postgresql://%PGUSERNAME%:%PGPASSWORD%@localhost:5432/couple_money_demo"
>> .env echo DATABASE_URL_UNPOOLED="postgresql://%PGUSERNAME%:%PGPASSWORD%@localhost:5432/couple_money_demo"
echo       完成

echo [3/4] 安裝套件（第一次比較久，1~3 分鐘，請不要關視窗）...
call npm install
if errorlevel 1 (
  echo.
  echo [X] npm install 失敗，請把上面的紅字截圖給我。
  pause
  exit /b 1
)

echo [4/4] 建立資料表 ...
call npx prisma migrate deploy
if errorlevel 1 (
  echo.
  echo [X] 連不上資料庫。最常見原因：
  echo     1. PostgreSQL 服務沒有啟動
  echo     2. 剛剛輸入的使用者名稱或密碼不對
  echo     3. 密碼裡有 @ : / 這類符號（請改用沒有特殊符號的密碼再試）
  pause
  exit /b 1
)

echo.
echo 放入示範資料 ...
call npx tsx scripts/seed-demo.ts

echo.
echo ==================================================
echo   設定完成！
echo   接下來請雙擊「2-啟動.bat」開始試用。
echo ==================================================
echo.
pause
