#!/usr/bin/env bash
# Выкатка EcoCub в k3s (ns ecocub). Запуск из корня репозитория: bash deploy/k3s/deploy.sh
# Собирает образ buildah'ом НА УЗЛЕ (npm ci + vite build), импортирует в containerd, применяет манифесты.
# Откат: ssh ... 'kubectl -n ecocub rollout undo deployment/ecocub-web'  (или deploy.sh <старый-тег> --no-build)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
KEY=(-i "$HOME/.ssh/rgrouter_ed25519" -o IdentitiesOnly=yes -o ConnectTimeout=20)
HOST=root@139.100.213.97
TAG=${1:-$(git rev-parse --short=12 HEAD)}
IMG=localhost/ecocub-web:$TAG
D=/opt/renomme-infra/ecocub
if [ "${2:-}" != "--no-build" ]; then
  git archive --format=tar.gz -o "${TMPDIR:-/tmp}/ecocub-src.tgz" HEAD
  ssh "${KEY[@]}" $HOST "mkdir -p $D/src $D/images && rm -rf $D/src/*"
  scp -q "${KEY[@]}" "${TMPDIR:-/tmp}/ecocub-src.tgz" $HOST:$D/
  ssh "${KEY[@]}" $HOST "cd $D/src && tar xzf ../ecocub-src.tgz && buildah --storage-driver overlay bud --isolation chroot -q -t $IMG . && buildah --storage-driver overlay push $IMG oci-archive:$D/images/web.tar:$IMG && k3s ctr images import $D/images/web.tar >/dev/null && echo imported"
fi
sed "s#ECOCUB_WEB_IMAGE#$IMG#" deploy/k3s/application.yaml > "${TMPDIR:-/tmp}/ecocub-app.yaml"
scp -q "${KEY[@]}" "${TMPDIR:-/tmp}/ecocub-app.yaml" deploy/k3s/namespace.yaml deploy/k3s/ingress-preview.yaml deploy/k3s/ingress-production.yaml $HOST:$D/
# секрет из локального файла (не из git)
SECRET_B64=$(base64 -w0 < "$HOME/.claude/secrets/ecocub_prod.env")
ssh "${KEY[@]}" $HOST "cd $D && kubectl apply -f namespace.yaml && echo $SECRET_B64 | base64 -d > env.tmp && kubectl -n ecocub create secret generic ecocub-env --from-env-file=env.tmp --dry-run=client -o yaml | kubectl apply -f - && rm -f env.tmp && kubectl apply -f ecocub-app.yaml -f ingress-preview.yaml -f ingress-production.yaml && kubectl -n ecocub rollout status deployment/ecocub-web --timeout=240s"
code=$(curl -s -o /dev/null -w "%{http_code}" https://ecocub.139.100.213.97.nip.io/)
echo "preview: HTTP $code, образ $IMG"; [ "$code" = 200 ]
