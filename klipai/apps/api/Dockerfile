# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# Mobil çalışma alanı imajda gerekmez; kilit dosyası uyumu için boş paket bildirimi yeterli.
RUN mkdir -p apps/mobile && echo '{"name":"@klipai/mobile","version":"1.0.0","private":true}' > apps/mobile/package.json
RUN npm ci --workspace @klipai/api --workspace @klipai/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @klipai/shared && npm run build -w @klipai/api

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost:3000/v1/health || exit 1
# Göç ayrı bir adımda çalıştırılır (docker compose: migrate servisi; CI/CD: deploy öncesi iş).
CMD ["node", "dist/main.js"]
