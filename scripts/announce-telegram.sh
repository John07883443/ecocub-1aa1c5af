#!/usr/bin/env bash
#
# Анонс новых статей блога в Telegram через бота.
#
# Запускается из GitHub Actions (notify-telegram.yml), где есть открытый
# интернет и секреты TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID. Тот же бот, что
# шлёт уведомления о заявках.
#
# Логика:
#   - если задан SLUG — анонсируем именно эту статью (ручной запуск);
#   - иначе — берём статьи, ДОБАВЛЕННЫЕ последним коммитом (git diff, статус A).
# Изменённые (не новые) статьи намеренно не анонсируются.
#
set -euo pipefail

SITE="https://eco-cub.ru"

if [ -z "${TG_TOKEN:-}" ] || [ -z "${TG_CHAT:-}" ]; then
  echo "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не заданы в секретах Actions — пропускаю отправку."
  exit 0
fi

# Достаёт значение поля front matter (только из первого блока между --- ---).
get_field() {
  awk -v key="$1" '
    /^---[[:space:]]*$/ { c++; if (c==1) { infm=1; next } else { exit } }
    infm && index($0, key ":") == 1 {
      line = $0
      sub("^" key ":[[:space:]]*", "", line)
      sub(/[[:space:]]+$/, "", line)
      if (substr(line,1,1) == "\"" && substr(line,length(line),1) == "\"")
        line = substr(line, 2, length(line) - 2)
      print line
      exit
    }
  ' "$2"
}

announce_file() {
  local f="$1"
  if [ ! -f "$f" ]; then
    echo "Файл не найден, пропускаю: $f"
    return 0
  fi

  local title slug excerpt cover url caption
  title=$(get_field title "$f")
  slug=$(get_field slug "$f")
  excerpt=$(get_field excerpt "$f")
  cover=$(get_field cover "$f")

  [ -n "$slug" ]  || slug=$(basename "$f" .md)
  if [ -z "$title" ]; then
    echo "Нет заголовка в $f, пропускаю."
    return 0
  fi

  url="$SITE/blog/$slug"
  caption=$(printf '🏠 Новая статья в блоге EcoCub\n\n%s\n\n%s\n\n%s' "$title" "$excerpt" "$url")

  echo "Отправляю в Telegram: $slug"
  if [ -n "$cover" ]; then
    curl -sS -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendPhoto" \
      -F chat_id="${TG_CHAT}" \
      -F photo="${cover}" \
      -F caption="${caption}" \
      --max-time 30
  else
    curl -sS -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
      -F chat_id="${TG_CHAT}" \
      -F text="${caption}" \
      --max-time 30
  fi
  echo
  echo "Готово: $slug"
}

if [ -n "${SLUG:-}" ]; then
  announce_file "content/blog/${SLUG}.md"
  exit 0
fi

# Новые статьи в последнем коммите.
base="HEAD~1"
if ! git rev-parse --verify -q "$base" >/dev/null 2>&1; then
  base=$(git hash-object -t tree /dev/null)   # пустое дерево, если родителя нет
fi

added=$(git diff --diff-filter=A --name-only "$base" HEAD -- 'content/blog/*.md' || true)
if [ -z "$added" ]; then
  echo "Новых статей в последнем коммите нет — отправлять нечего."
  exit 0
fi

while IFS= read -r f; do
  [ -n "$f" ] && announce_file "$f"
done <<< "$added"
