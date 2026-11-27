#!/usr/bin/env bash
#
# Ключ ленты Медиамашины для живого блога — в окружение сайта на main-1.
# Запускает владелец с ПК (Git Bash); ключ вводится без показа на экране,
# не попадает ни в историю команд, ни в аргументы процессов, ни в журнал:
#
#   bash scripts/main1/set-mm-key.sh
#
# Пишет MM_SITE_KEY в /etc/ecocub.env (права 600, прочие строки не трогает),
# перезапускает ecocub и проверяет, что лента с этим ключом отвечает 200.
# Тот же ключ кладётся в секрет GitHub MM_SITE_KEY — его читает часовой синк.

set -euo pipefail
HOST="${ECOCUB_HOST:-178.130.63.130}"
ROOT_KEY="${ECOCUB_SSH_KEY:-$HOME/.ssh/selectel_main1}"

read -r -s -p "Ключ Медиамашины (mm_...), ввод не виден: " key; echo
[[ "$key" =~ ^[A-Za-z0-9_.-]{10,200}$ ]] || { echo "Не похоже на ключ — ничего не менял."; exit 1; }

printf '%s\n' "$key" | ssh -i "$ROOT_KEY" -o BatchMode=yes -o LogLevel=ERROR "root@$HOST" 'set -euo pipefail
  read -r key
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
    -K - <<<"url = \"https://mediamachina.ru/api/site/v1/articles?limit=1&key=$key\"")
  [ "$code" = 200 ] || { echo "[main-1] лента ответила $code на этот ключ — в окружение не записал"; exit 1; }
  f=/etc/ecocub.env
  cp -p "$f" "$f.bak-mm"
  { grep -v "^MM_SITE_KEY=" "$f" || true; printf "MM_SITE_KEY=%s\n" "$key"; } > "$f.new"
  chmod 600 "$f.new"; chown --reference="$f" "$f.new"; mv "$f.new" "$f"
  systemctl restart ecocub
  for i in $(seq 1 30); do sleep 1; curl -sf -o /dev/null http://127.0.0.1:3010/blog && break; done
  echo "[main-1] ключ записан, лента 200, сайт перезапущен: /blog $(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:3010/blog)"'
