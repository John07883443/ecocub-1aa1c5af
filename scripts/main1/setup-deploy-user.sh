#!/usr/bin/env bash
#
# Один раз: готовит main-1 к автодеплою из GitHub. Запускается с ПК (Git Bash):
#
#   bash scripts/main1/setup-deploy-user.sh
#
# Что делает:
#   1. Создаёт на ПК ключ ~/.ssh/ecocub_actions_deploy (если его нет). Закрытая
#      часть уходит только в секрет GitHub MAIN1_DEPLOY_KEY, на экран не выводится.
#   2. Ставит на сервер ecocub-deploy и ecocub-deploy-ssh (deploy-main1.sh install).
#   3. Заводит пользователя deploy-ecocub без пароля. Его ключ привязан к
#      принудительной команде: только deploy <релиз> | rollback | status,
#      без shell и проброса портов. sudo разрешён ровно на /usr/local/sbin/ecocub-deploy.
#   4. Проверяет: status проходит, произвольная команда отклоняется.
#
# Повторный запуск безопасен. Убрать доступ: userdel -r deploy-ecocub &&
# rm /etc/sudoers.d/ecocub-deploy на сервере.

set -euo pipefail
cd "$(dirname "$0")/../.."

HOST="${ECOCUB_HOST:-178.130.63.130}"
ROOT_KEY="${ECOCUB_SSH_KEY:-$HOME/.ssh/selectel_main1}"
KEY="${ECOCUB_ACTIONS_KEY:-$HOME/.ssh/ecocub_actions_deploy}"
SSH=(ssh -i "$ROOT_KEY" -o BatchMode=yes -o LogLevel=ERROR "root@$HOST")

[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C github-actions-ecocub -f "$KEY"
echo "[setup] ключ: $KEY (закрытую часть не показываю)"

ECOCUB_SSH_TARGET="root@$HOST" ECOCUB_SSH_KEY="$ROOT_KEY" bash scripts/deploy-main1.sh install

"${SSH[@]}" PUB="$(printf %q "$(cat "$KEY.pub")")" bash -s <<'EOF'
set -euo pipefail
id deploy-ecocub >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash deploy-ecocub
passwd -l deploy-ecocub >/dev/null
install -d -m 700 -o deploy-ecocub -g deploy-ecocub /home/deploy-ecocub/.ssh
printf 'command="/usr/local/bin/ecocub-deploy-ssh",restrict %s\n' "$PUB" > /home/deploy-ecocub/.ssh/authorized_keys
chown deploy-ecocub: /home/deploy-ecocub/.ssh/authorized_keys
chmod 600 /home/deploy-ecocub/.ssh/authorized_keys
cat > /etc/sudoers.d/ecocub-deploy.tmp <<'S'
# Выкладка eco-cub.ru из GitHub Actions: только этот скрипт, аргументы он проверяет сам.
deploy-ecocub ALL=(root) NOPASSWD: /usr/local/sbin/ecocub-deploy deploy *, /usr/local/sbin/ecocub-deploy rollback, /usr/local/sbin/ecocub-deploy status
S
chmod 440 /etc/sudoers.d/ecocub-deploy.tmp
visudo -cqf /etc/sudoers.d/ecocub-deploy.tmp && mv /etc/sudoers.d/ecocub-deploy.tmp /etc/sudoers.d/ecocub-deploy
echo "[main-1] пользователь deploy-ecocub готов"
EOF

D=(ssh -i "$KEY" -o BatchMode=yes -o LogLevel=ERROR -o IdentitiesOnly=yes "deploy-ecocub@$HOST")
echo "[setup] проверка status ключом выкладки:"; "${D[@]}" status
if "${D[@]}" id >/dev/null 2>&1; then echo "[setup] ОШИБКА: ключ выполнил произвольную команду"; exit 1; fi
echo "[setup] произвольная команда отклонена — так и должно быть. Готово."
