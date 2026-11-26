#!/usr/bin/env bash
#
# Выкладка eco-cub.ru на собственный сервер (main-1, systemd, без pm2) с ПК.
# Автодеплой из GitHub (.github/workflows/deploy.yml) делает то же самое:
# вся логика релизов живёт на сервере в scripts/main1/ecocub-deploy.
#
# Сборка идёт НЕ на сервере: рядом живут другие службы, а сборке нужно
# около 1,5 ГБ памяти.
#
#   npm ci && NITRO_PRESET=node-server npm run build
#   scripts/deploy-main1.sh            # выложить .output
#   scripts/deploy-main1.sh rollback   # вернуть предыдущий релиз
#   scripts/deploy-main1.sh status     # что сейчас работает и что лежит
#   scripts/deploy-main1.sh install    # поставить/обновить серверные скрипты
#
# Для stage-копии: ECOCUB_APP_DIR=/opt/ecocub-stage ECOCUB_SERVICE=ecocub-stage
# ECOCUB_PORT=3011 scripts/deploy-main1.sh

set -euo pipefail

SSH_TARGET="${ECOCUB_SSH_TARGET:-root@178.130.63.130}"
SSH_KEY="${ECOCUB_SSH_KEY:-$HOME/.ssh/selectel_main1}"
BUILD_DIR="${ECOCUB_BUILD_DIR:-.output}"
HERE="$(cd "$(dirname "$0")" && pwd)"

log() { printf '[deploy-main1] %s\n' "$*"; }
fail() { printf '[deploy-main1] ОШИБКА: %s\n' "$*" >&2; exit 1; }

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15 -o LogLevel=ERROR)
[ -f "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")
remote() { ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"; }

# Переменные для stage передаём явно (root через ssh, без sudo — доходят).
remote_env() {
  local v out=""
  for v in ECOCUB_APP_DIR ECOCUB_SERVICE ECOCUB_RUN_USER ECOCUB_PORT ECOCUB_KEEP ECOCUB_HEALTH_PATHS; do
    [ -n "${!v:-}" ] && out+="$v=$(printf '%q' "${!v}") "
  done
  printf '%s' "$out"
}

cmd_install() {
  log "ставлю ecocub-deploy и ecocub-deploy-ssh на $SSH_TARGET"
  tar -cf - -C "$HERE/main1" ecocub-deploy ecocub-deploy-ssh | remote 'set -e
    t=$(mktemp -d); tar -xf - -C "$t"
    install -m 0755 -o root -g root "$t/ecocub-deploy" /usr/local/sbin/ecocub-deploy
    install -m 0755 -o root -g root "$t/ecocub-deploy-ssh" /usr/local/bin/ecocub-deploy-ssh
    rm -rf "$t"; echo "[main-1] скрипты обновлены"'
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
  log "релиз $release → $SSH_TARGET"
  # rsync есть не везде (в Git Bash на Windows его нет), поэтому tar через ssh.
  tar -czf - -C "$BUILD_DIR" . | remote "$(remote_env)/usr/local/sbin/ecocub-deploy deploy $release"
}

case "${1:-deploy}" in
  deploy) cmd_deploy ;;
  rollback|status) remote "$(remote_env)/usr/local/sbin/ecocub-deploy $1" ;;
  install) cmd_install ;;
  *) fail "команда: deploy | rollback | status | install" ;;
esac
