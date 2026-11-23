#!/usr/bin/env bash
#
# Выкладка eco-cub.ru на собственный сервер (main-1, systemd, без pm2).
#
# Сборка идёт НЕ на сервере: рядом живут другие службы, а сборке нужно
# около 1,5 ГБ памяти. Собираем там, где запускаем скрипт (ПК или Actions):
#
#   npm ci && NITRO_PRESET=node-server npm run build
#   scripts/deploy-main1.sh            # выложить .output
#   scripts/deploy-main1.sh rollback   # вернуть предыдущий релиз
#   scripts/deploy-main1.sh status     # что сейчас работает и что лежит
#
# Устройство на сервере:
#   $APP_DIR/releases/<время>-<sha>/   — содержимое .output, по релизу на папку
#   $APP_DIR/current -> releases/...   — симлинк, его читает служба
#   служба: WorkingDirectory=$APP_DIR/current, ExecStart=node server/index.mjs
#
# Подмена симлинка атомарна. Если после перезапуска сайт не отвечает 200 на
# ключевых страницах, симлинк возвращается на прежний релиз автоматически.
# Хранится $KEEP последних релизов (текущий и предыдущий не удаляются никогда).
#
# Все параметры переопределяются переменными окружения — путей конкретной
# машины в скрипте нет, кроме значений по умолчанию.

set -euo pipefail

SSH_TARGET="${ECOCUB_SSH_TARGET:-root@178.130.63.130}"
SSH_KEY="${ECOCUB_SSH_KEY:-$HOME/.ssh/selectel_main1}"
APP_DIR="${ECOCUB_APP_DIR:-/opt/ecocub}"
SERVICE="${ECOCUB_SERVICE:-ecocub}"
RUN_USER="${ECOCUB_RUN_USER:-ecocub}"
PORT="${ECOCUB_PORT:-3010}"
KEEP="${ECOCUB_KEEP:-3}"
HEALTH_PATHS="${ECOCUB_HEALTH_PATHS:-/ /portfolio /blog /sitemap.xml}"
BUILD_DIR="${ECOCUB_BUILD_DIR:-.output}"

log() { printf '[deploy-main1] %s\n' "$*"; }
fail() { printf '[deploy-main1] ОШИБКА: %s\n' "$*" >&2; exit 1; }

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15 -o LogLevel=ERROR)
[ -f "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")
remote() { ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"; }

# Общая часть для сервера: проверка здоровья и переключение симлинка.
# Передаётся в начало каждого удалённого сценария.
REMOTE_LIB=$(cat <<'LIB'
set -euo pipefail
log() { printf '[main-1] %s\n' "$*"; }
health() {
  local ok=0
  for _ in $(seq 1 30); do
    sleep 1
    curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/" && { ok=1; break; }
  done
  [ "$ok" = 1 ] || { log "главная не ответила за 30 с"; return 1; }
  local p code bad=0
  for p in $HEALTH_PATHS; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1:$PORT$p" || true)
    log "  $p -> $code"
    [ "$code" = 200 ] || bad=1
  done
  return $bad
}
switch_to() {  # $1 — имя релиза
  ln -sfn "releases/$1" "$APP_DIR/current.new"
  mv -T "$APP_DIR/current.new" "$APP_DIR/current"
  systemctl restart "$SERVICE"
}
LIB
)

remote_env() {
  printf 'APP_DIR=%q SERVICE=%q RUN_USER=%q PORT=%q KEEP=%q HEALTH_PATHS=%q\n' \
    "$APP_DIR" "$SERVICE" "$RUN_USER" "$PORT" "$KEEP" "$HEALTH_PATHS"
  printf '%s\n' "$REMOTE_LIB"
}

cmd_status() {
  { remote_env; cat <<'EOF'
echo "служба: $(systemctl is-active "$SERVICE")"
echo "current -> $(readlink "$APP_DIR/current" 2>/dev/null || echo 'нет')"
echo "релизы:"; ls -1 "$APP_DIR/releases" 2>/dev/null | sed 's/^/  /'
EOF
  } | remote bash -s
}

cmd_rollback() {
  log "откат на предыдущий релиз"
  { remote_env; cat <<'EOF'
cur=$(basename "$(readlink "$APP_DIR/current")")
prev=$(ls -1 "$APP_DIR/releases" | sort | grep -B1 -x "$cur" | head -n1)
[ -n "$prev" ] && [ "$prev" != "$cur" ] || { log "нет релиза старше $cur"; exit 1; }
log "$cur -> $prev"
switch_to "$prev"
health && log "готово, работает $prev" || { log "после отката сайт не отвечает — нужны руки"; exit 1; }
EOF
  } | remote bash -s
}

cmd_deploy() {
  [ -f "$BUILD_DIR/server/index.mjs" ] || fail "нет $BUILD_DIR/server/index.mjs — сначала соберите сайт"
  grep -q '"preset": "node-server"' "$BUILD_DIR/nitro.json" \
    || fail "сборка не под Node (ожидался preset node-server): NITRO_PRESET=node-server npm run build"

  local sha dirty=""
  sha=$(git rev-parse --short HEAD 2>/dev/null || echo nogit)
  # Сгенерированный routeTree.gen.ts меняется при каждой сборке — не считаем его правкой.
  if [ -n "$(git status --porcelain --untracked-files=no -- . ':!src/routeTree.gen.ts' 2>/dev/null)" ]; then
    dirty="-dirty"
  fi
  local release
  release="$(date -u +%Y%m%d-%H%M%S)-$sha$dirty"
  log "релиз $release → $SSH_TARGET:$APP_DIR"

  # rsync есть не везде (в Git Bash на Windows его нет), поэтому tar через ssh.
  log "передаю сборку"
  tar -czf - -C "$BUILD_DIR" . \
    | remote "set -e; mkdir -p '$APP_DIR/releases/$release.part'; tar -xzf - -C '$APP_DIR/releases/$release.part'"

  { remote_env; printf 'RELEASE=%q\n' "$release"; cat <<'EOF'
part="$APP_DIR/releases/$RELEASE.part"
grep -q '"preset": "node-server"' "$part/nitro.json" || { rm -rf "$part"; log "на сервер приехала не та сборка"; exit 1; }
chown -R "$RUN_USER:$RUN_USER" "$part"
mv -T "$part" "$APP_DIR/releases/$RELEASE"

prev=$(basename "$(readlink "$APP_DIR/current" 2>/dev/null || true)")
log "было: ${prev:-нет}, становится: $RELEASE"
switch_to "$RELEASE"

if health; then
  log "сайт отвечает, релиз $RELEASE работает"
else
  if [ -n "$prev" ] && [ -d "$APP_DIR/releases/$prev" ]; then
    log "новый релиз не поднялся — возвращаю $prev"
    switch_to "$prev"
    # Сломанный релиз не храним: иначе он займёт место в KEEP и попадётся `rollback`.
    rm -rf "${APP_DIR:?}/releases/$RELEASE"
    health && { log "откат выполнен, работает $prev; сломанный $RELEASE удалён"; exit 2; }
    log "после отката сайт всё ещё не отвечает — нужны руки"; exit 3
  fi
  log "новый релиз не поднялся, откатываться не на что — нужны руки"; exit 3
fi

# Чистка: оставляем KEEP последних, текущий и предыдущий не трогаем никогда.
ls -1 "$APP_DIR/releases" | grep -v '\.part$' | sort | head -n -"$KEEP" | while read -r r; do
  [ "$r" = "$RELEASE" ] || [ "$r" = "$prev" ] && continue
  rm -rf "${APP_DIR:?}/releases/$r" && log "удалён старый релиз $r"
done
rm -rf "$APP_DIR"/releases/*.part
EOF
  } | remote bash -s
}

case "${1:-deploy}" in
  deploy) cmd_deploy ;;
  rollback) cmd_rollback ;;
  status) cmd_status ;;
  *) fail "команда: deploy | rollback | status" ;;
esac
