# EcoCub: TanStack Start (Nitro node-server) для k3s. Сборка: deploy/k3s/deploy.sh
# NITRO_PRESET=node-server задан и в vite.config.ts; переменная здесь — страховка от смены конфига Lovable.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NITRO_PRESET=node-server NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build \
 && test -f .output/server/index.mjs \
 && grep -q '"preset": "node-server"' .output/nitro.json

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 \
    LEADS_DB_PATH=/var/lib/ecocub/leads.db \
    HOUSE_PROJECTS_DB_PATH=/var/lib/ecocub/house-projects.db
WORKDIR /app
COPY --from=build /app/.output ./.output
# content/ читается на сервере как резерв карточек проектов (если Supabase недоступен)
COPY --from=build /app/content ./content
RUN mkdir -p /var/lib/ecocub && chown node:node /var/lib/ecocub
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
