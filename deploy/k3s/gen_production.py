"""Генерирует ingress-production.yaml: VirtualServer eco-cub.ru с 301 из deploy_redirects_tpost.conf."""
import re
from pathlib import Path
here = Path(__file__).resolve().parent
src = (here / '../../deploy_redirects_tpost.conf').read_text(encoding='utf8')
routes = re.findall(r'location ~ \^(/tpost/\S+?) \{ return 301 (\S+); \}', src)
o = ["# Нужен DNS: A @ и www -> 139.100.213.97. Редиректы /tpost/* из deploy_redirects_tpost.conf (старый nginx).",
"# Файл сгенерирован gen_production.py",
"apiVersion: k8s.nginx.org/v1","kind: VirtualServer","metadata: {name: ecocub-production, namespace: ecocub}","spec:",
"  ingressClassName: nginx","  host: eco-cub.ru","  tls:","    secret: ecocub-production-tls","    redirect: {enable: true, code: 301}",
"    cert-manager: {issuer: letsencrypt}","  upstreams:","    - name: web","      service: ecocub-web","      port: 3000","  routes:"]
for p, t in routes:
    o += [f'    - path: "~ ^{p}"', "      action:", "        redirect:", f"          url: https://eco-cub.ru{t}", "          code: 301"]
o += ['    - path: "~ ^/tpost/"', "      action:", "        redirect:", "          url: https://eco-cub.ru/blog", "          code: 301",
"    - path: /", "      action: {pass: web}", "---",
"apiVersion: k8s.nginx.org/v1","kind: VirtualServer","metadata: {name: ecocub-www, namespace: ecocub}","spec:","  ingressClassName: nginx",
"  host: www.eco-cub.ru","  tls:","    secret: ecocub-www-tls","    redirect: {enable: true, code: 301}","    cert-manager: {issuer: letsencrypt}",
"  routes:","    - path: /","      action:","        redirect:","          url: https://eco-cub.ru${request_uri}","          code: 301"]
(here / 'ingress-production.yaml').write_text("\n".join(o) + "\n", encoding='utf8', newline='\n')
print(len(routes), 'routes')
