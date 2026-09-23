#!/usr/bin/env bash
#
# 資料備份（Phase 3-4 G）。
#
# 這是**真正的備份**：整個 PostgreSQL 資料庫 + 上傳的照片。
# CSV 匯出只是給試算表看的明細，還原不了 App，不要拿它當備份。
#
# 用法：
#   bash scripts/backup.sh                      # 備份到 ./backups/
#   BACKUP_DIR=/mnt/nas/cm bash scripts/backup.sh
#
# 還原（會覆蓋現有資料，請先確認連的是正確的資料庫）：
#   createdb couple_money                       # 資料庫不存在時
#   pg_restore --clean --if-exists -d "$DATABASE_URL" backups/<日期>/db.dump
#   tar xzf backups/<日期>/uploads.tar.gz -C "$(dirname "$UPLOAD_DIR")"
#
set -euo pipefail

cd "$(dirname "$0")/.."

# DATABASE_URL 優先吃環境變數，否則讀 .env
DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ] && [ -f .env ]; then
  DB_URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' || true)
fi
if [ -z "$DB_URL" ]; then
  echo "找不到 DATABASE_URL（請設環境變數或寫在 .env）" >&2
  exit 1
fi

UPLOADS="${UPLOAD_DIR:-.uploads}"
STAMP=$(date +%Y-%m-%d_%H%M)
OUT="${BACKUP_DIR:-backups}/$STAMP"
mkdir -p "$OUT"

echo "→ 備份資料庫…"
pg_dump --format=custom --no-owner --no-acl --file "$OUT/db.dump" "$DB_URL"

if [ -d "$UPLOADS" ]; then
  echo "→ 備份照片（$UPLOADS）…"
  tar czf "$OUT/uploads.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
else
  echo "→ 沒有 $UPLOADS，略過照片"
fi

cat > "$OUT/README.txt" <<TXT
Couple Money 備份 $STAMP

db.dump          pg_dump custom format（含所有資料表與 migration 紀錄）
uploads.tar.gz   上傳的照片（打卡照片與記帳收據）

還原：
  pg_restore --clean --if-exists -d "<DATABASE_URL>" db.dump
  tar xzf uploads.tar.gz -C <UPLOAD_DIR 的上層資料夾>

注意：CSV 匯出不是備份，只有這份 db.dump 才還原得回整個 App。
TXT

echo "✓ 完成：$OUT"
du -sh "$OUT"
