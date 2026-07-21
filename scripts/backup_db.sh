#!/bin/bash
# PULSE DB 일일 백업 — crontab에 등록: 0 4 * * * /path/to/pulse/scripts/backup_db.sh
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB="$DIR/data/pulse.db"
OUT="$DIR/data/backups"
mkdir -p "$OUT"
TS=$(date +%Y%m%d_%H%M%S)
# SQLite VACUUM INTO 명령으로 일관된 백업 (사용 중에도 안전)
sqlite3 "$DB" "VACUUM INTO '$OUT/pulse_$TS.db'" 2>/dev/null || cp "$DB" "$OUT/pulse_$TS.db"
# 14일 이상된 백업 삭제
find "$OUT" -name "pulse_*.db" -mtime +14 -delete 2>/dev/null
echo "[$(date)] backup: pulse_$TS.db ($(du -h "$OUT/pulse_$TS.db" | cut -f1))"
