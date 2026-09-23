#!/usr/bin/env bash
# 非互動產生 migration：scripts/new-migration.sh <名稱>
set -euo pipefail
name="$1"
dir="prisma/migrations/$(date -u +%Y%m%d%H%M%S)_${name}"
mkdir -p "$dir"
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "${SHADOW_DATABASE_URL:-postgresql://cm:cm@localhost:5432/couple_money_shadow}" \
  --script > "$dir/migration.sql"
echo "建立 $dir"
