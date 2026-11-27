#!/usr/bin/env bash
#
# Ключ ленты Медиамашины для живого блога — на main-1, в два шага.
#
#   bash scripts/main1/set-mm-key.sh            # владелец: ввести ключ (на проверку)
#   bash scripts/main1/set-mm-key.sh activate   # агент: включить проверенный ключ
#   bash scripts/main1/set-mm-key.sh discard    # агент: выбросить непроверенный ключ
#
# Шаг 1 (владелец). Ключ вводится без показа на экране и не попадает ни в
# историю, ни в аргументы процессов. Сервер проверяет, что лента отвечает 200,
# и кладёт ключ В КАРАНТИН: /etc/ecocub-mm-key.pending (600, root). Сайт его
# ещё не видит. Рядом — /var/lib/ecocub-mm-check.txt: сколько статей отдаёт
# лента, их заголовки и адреса (без ключа), чтобы убедиться, что лента именно
# ЭкоКуба, а не чужого сайта.
#
# Шаг 2 (агент, после сверки заголовков). activate переносит ключ в
# /etc/ecocub.env как MM_SITE_KEY и перезапускает сайт; discard удаляет
# карантин. Ключ при этом через ПК не проходит.

set -euo pipefail
HOST="${ECOCUB_HOST:-178.130.63.130}"
ROOT_KEY="${ECOCUB_SSH_KEY:-$HOME/.ssh/selectel_main1}"
SSH=(ssh -i "$ROOT_KEY" -o BatchMode=yes -o LogLevel=ERROR "root@$HOST")

case "${1:-put}" in
put)
  read -r -s -p "Ключ Медиамашины, ввод не виден: " key; echo
  [[ "$key" =~ ^[A-Za-z0-9_.-]{10,200}$ ]] || { echo "Не похоже на ключ — ничего не менял."; exit 1; }
  printf '%s\n' "$key" | "${SSH[@]}" 'set -euo pipefail
    read -r key
    tmp=$(mktemp); trap "rm -f $tmp" EXIT
    code=$(curl -s -o "$tmp" -w "%{http_code}" --max-time 20 \
      -K - <<<"url = \"https://mediamachina.ru/api/site/v1/articles?limit=50&key=$key\"")
    if [ "$code" != 200 ]; then echo "[main-1] лента ответила $code на этот ключ — никуда не записал"; exit 1; fi
    umask 077; printf "%s\n" "$key" > /etc/ecocub-mm-key.pending
    node -e "
      const a = JSON.parse(require(\"fs\").readFileSync(process.argv[1], \"utf8\")).articles ?? [];
      const out = [\"проверено: \" + new Date().toISOString(), \"статей в ленте: \" + a.length];
      for (const x of a.slice(0, 15)) out.push(\"- \" + String(x.publishedAt ?? \"\").slice(0, 10) + \" | \" + x.slug + \" | \" + x.title);
      require(\"fs\").writeFileSync(\"/var/lib/ecocub-mm-check.txt\", out.join(\"\\n\") + \"\\n\");
    " "$tmp"
    echo "[main-1] лента 200, ключ отложен на проверку (сайт его ещё не видит). Статей: $(sed -n 2p /var/lib/ecocub-mm-check.txt | grep -o "[0-9]*$")"'
  echo "Готово. Агент сверит, что статьи ЭкоКуба, и включит ключ сам."
  ;;
activate)
  "${SSH[@]}" 'set -euo pipefail
    p=/etc/ecocub-mm-key.pending; f=/etc/ecocub.env
    [ -s "$p" ] || { echo "[main-1] ключа на проверке нет"; exit 1; }
    cp -p "$f" "$f.bak-mm"
    { grep -v "^MM_SITE_KEY=" "$f" || true; printf "MM_SITE_KEY=%s\n" "$(cat "$p")"; } > "$f.new"
    chmod 600 "$f.new"; chown --reference="$f" "$f.new"; mv "$f.new" "$f"; rm -f "$p"
    systemctl restart ecocub
    for i in $(seq 1 30); do sleep 1; curl -sf -o /dev/null http://127.0.0.1:3010/blog && break; done
    echo "[main-1] ключ включён, сайт перезапущен: /blog $(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:3010/blog)"'
  ;;
discard)
  "${SSH[@]}" 'rm -f /etc/ecocub-mm-key.pending && echo "[main-1] непроверенный ключ удалён"'
  ;;
check)
  "${SSH[@]}" 'cat /var/lib/ecocub-mm-check.txt 2>/dev/null || echo "проверок ещё не было"; [ -s /etc/ecocub-mm-key.pending ] && echo "ключ на проверке: есть" || echo "ключ на проверке: нет"'
  ;;
*) echo "команды: (без аргументов) | activate | discard | check"; exit 1 ;;
esac
