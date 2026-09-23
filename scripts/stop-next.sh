#!/usr/bin/env bash
# 停止本機背景執行中的 next start（用行程名稱比對，不會誤殺自己的 shell）
for pid in $(ps -eo pid=,comm= | awk '$2 ~ /^next-server/ {print $1}'); do kill "$pid" 2>/dev/null; done
exit 0
