#!/usr/bin/env bash
# Судья на VPS (там лежит RGROUTER_API_KEY): заливает прогон, судит, забирает отчёт.
#   bash judge-on-vps.sh out/<run> ../../docs/QA_CONSTRUCTOR_<дата>.md [префикс ссылок на картинки]
# Ключ не выходит с сервера и не печатается. Каталог на VPS: /home/deploy/qa/runs/<run>.
set -euo pipefail
RUN_DIR=${1:?каталог прогона}; REPORT=${2:?путь отчёта}; PREFIX=${3:-}
SSH=${QA_SSH:-"ssh -i $HOME/.ssh/ecocub_vps -o BatchMode=yes deploy@eco-cub.ru"}
RUN=$(basename "$RUN_DIR")
cd "$(dirname "$0")"
$SSH "mkdir -p /home/deploy/qa/runs"
tar czf - judge.ts | $SSH "cd /home/deploy/qa && tar xzf -"
tar czf - -C "$(dirname "$RUN_DIR")" "$RUN" | $SSH "cd /home/deploy/qa/runs && tar xzf -"
$SSH "cd /home/deploy/qa && set -a && . /home/deploy/ecocub.env && set +a && \
  QA_REUSE_JUDGED=${QA_REUSE_JUDGED:-0} node --experimental-strip-types judge.ts runs/$RUN runs/$RUN/report.md '$PREFIX' 2>&1 | grep -v ExperimentalWarning"
$SSH "cat /home/deploy/qa/runs/$RUN/report.md" > "$REPORT"
$SSH "cat /home/deploy/qa/runs/$RUN/judged.json" > "$RUN_DIR/judged.json"
echo "Отчёт: $REPORT"
