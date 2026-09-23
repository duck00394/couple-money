@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Couple Money - 重建示範資料

echo ==================================================
echo   把試用資料庫清空，重新放一份乾淨的示範資料
echo   （只會動 couple_money_demo，不會碰其他資料庫）
echo ==================================================
echo.
set "YN="
set /p YN=確定要清空重來嗎？輸入 y 再按 Enter: 
if /i not "%YN%"=="y" (
  echo 已取消。
  pause
  exit /b 0
)

call npx tsx scripts/seed-demo.ts --reset
echo.
pause
