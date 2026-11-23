#!/usr/bin/env bash
#
# Ежедневная копия баз eco-cub.ru (заявки и проекты CAD Light) на main-1.
#
# sqlite3 на сервере нет и ставить его ради этого не нужно: копию делает
# встроенный в Node 22 модуль node:sqlite командой VACUUM INTO. Она даёт
# целостный снимок работающей базы в режиме WAL и не мешает записи заявок.
#
# Установка (от root):
#   install -m 755 ecocub-backup.sh /usr/local/sbin/ecocub-backup
#   install -m 644 ecocub-backup.service ecocub-backup.timer /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now ecocub-backup.timer
#
# Параметры: ECOCUB_DB_DIR (где базы), ECOCUB_BACKUP_DIR (куда), ECOCUB_BACKUP_DAYS.

set -euo pipefail

DB_DIR="${ECOCUB_DB_DIR:-/var/lib/ecocub}"
OUT_ROOT="${ECOCUB_BACKUP_DIR:-/var/backups/ecocub}"
DAYS="${ECOCUB_BACKUP_DAYS:-14}"
# node:sqlite в Node 22 печатает ExperimentalWarning — прячем только его, ошибки видны.
export NODE_NO_WARNINGS=1

stamp=$(date +%Y-%m-%d)
out="$OUT_ROOT/$stamp"
mkdir -p "$out"
chmod 700 "$OUT_ROOT"

found=0
for db in "$DB_DIR"/*.db; do
  [ -f "$db" ] || continue
  found=1
  name=$(basename "$db")
  rm -f "$out/$name"
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const [src, dst] = process.argv.slice(1);
    const db = new DatabaseSync(src, { readOnly: true });
    const q = String.fromCharCode(39);  // одинарная кавычка: снаружи bash-строка в одинарных
    db.exec("VACUUM INTO " + q + dst.split(q).join(q + q) + q);
    db.close();
  ' "$db" "$out/$name"
  # Проверка копии: открывается и проходит integrity_check.
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const r = new DatabaseSync(process.argv[1], { readOnly: true })
      .prepare("PRAGMA integrity_check").get();
    if (Object.values(r)[0] !== "ok") { console.error("integrity:", r); process.exit(1); }
  ' "$out/$name"
  echo "копия $name: $(du -h "$out/$name" | cut -f1)"
done

[ "$found" = 1 ] || echo "в $DB_DIR нет баз — копировать нечего"

find "$OUT_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$DAYS" -exec rm -rf {} + -print \
  | sed 's/^/удалена старая копия /'
