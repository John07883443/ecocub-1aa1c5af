#!/usr/bin/env bash
#
# Ключ ленты Медиамашины для живого блога — на main-1, в два шага.
#
#   bash scripts/main1/set-mm-key.sh            # владелец: скопировать ключ, Enter (на проверку)
#   bash scripts/main1/set-mm-key.sh activate   # агент: включить проверенный ключ
#   bash scripts/main1/set-mm-key.sh discard    # агент: выбросить непроверенный ключ
#
# Шаг 1 (владелец). Ключ берётся из буфера обмена (не печатается и не
# попадает ни в историю, ни в аргументы процессов), после — буфер очищается. Сервер проверяет, что лента отвечает 200,
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
  if [ -t 0 ]; then
    # Вставка Ctrl+V в скрытый ввод работает не во всех окнах, поэтому ключ
    # берём из буфера обмена сами — уже после того, как владелец его скопировал.
    read -r -p "Скопируйте ключ в кабинете МедиаМашины (Интеграции → «Сайт eco-cub.ru/blog/») и нажмите Enter здесь: " _
    key=$(cat /dev/clipboard 2>/dev/null || powershell.exe -NoProfile -Command Get-Clipboard 2>/dev/null || true)
    from_clipboard=1
  else
    read -r key || true   # для проверок: ключ через stdin
    from_clipboard=0
  fi
  # Вставка из буфера иногда приносит пробелы и невидимый \r по краям.
  key=$(printf '%s' "$key" | tr -d '\r\n\t ')
  if [ "${#key}" -lt 10 ] || [ "${#key}" -gt 500 ] || [[ "$key" == *[\"\'\\$\`]* ]]; then
    echo "Не похоже на ключ (длина ${#key}) — ничего не менял. Скопируйте ключ ещё раз целиком."; exit 1
  fi
  # Ключ уходит на сервер через stdin; там его читает node и подставляет
  # в адрес через encodeURIComponent — любые символы ключа безопасны.
  printf '%s\n' "$key" | "${SSH[@]}" 'node -e '"'"'
    const fs = require("fs");
    const key = fs.readFileSync(0, "utf8").trim();
    (async () => {
      const r = await fetch("https://mediamachina.ru/api/site/v1/articles?limit=50&key=" + encodeURIComponent(key),
        { signal: AbortSignal.timeout(20000) }).catch((e) => ({ status: "сеть: " + e.message }));
      if (r.status !== 200) { console.log("[main-1] лента ответила " + r.status + " на этот ключ — никуда не записал"); process.exit(1); }
      const a = (await r.json()).articles ?? [];
      fs.writeFileSync("/etc/ecocub-mm-key.pending", key + "\n", { mode: 0o600 });
      const out = ["проверено: " + new Date().toISOString(), "статей в ленте: " + a.length, "хвост ключа: …" + key.slice(-4)];
      for (const x of a.slice(0, 15)) out.push("- " + String(x.publishedAt ?? "").slice(0, 10) + " | " + x.slug + " | " + x.title);
      fs.writeFileSync("/var/lib/ecocub-mm-check.txt", out.join("\n") + "\n");
      console.log("[main-1] лента 200, ключ …" + key.slice(-4) + " отложен на проверку (сайт его ещё не видит). Статей: " + a.length);
    })();
  '"'"
  # Ключ в буфере больше не нужен — чистим, чтобы его случайно не вставили куда-то ещё.
  [ "$from_clipboard" = 1 ] && { printf '' > /dev/clipboard 2>/dev/null || true; }
  echo "Готово. Буфер очищен. Агент сверит, что статьи ЭкоКуба, и включит ключ сам."
  ;;
activate)
  "${SSH[@]}" 'set -euo pipefail
    p=/etc/ecocub-mm-key.pending; f=/etc/ecocub.env
    [ -s "$p" ] || { echo "[main-1] ключа на проверке нет"; exit 1; }
    cp -p "$f" "$f.bak-mm"
    { grep -v "^MM_SITE_KEY=" "$f" || true; printf "MM_SITE_KEY=%s\n" "$(cat "$p")"; } > "$f.new"
    chmod 600 "$f.new"; chown --reference="$f" "$f.new"; mv "$f.new" "$f"
    echo "[main-1] включаю ключ …$(tr -d "
" < "$p" | tail -c 4)"; rm -f "$p"
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
