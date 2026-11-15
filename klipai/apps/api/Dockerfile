# Yol: klipai/apps/api/Dockerfile
# Derleme bağlamı monorepo köküdür:  docker build -f apps/api/Dockerfile -t klipai-api .
# Aynı imaj iki rolde çalışır:  API → node dist/main.js   |   worker → node dist/worker.js
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @klipai/shared build && pnpm --filter @klipai/api build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# Prisma CLI (göç uygulamak için) ve derlenmiş çıktı birlikte taşınır.
COPY --from=build /app /app
WORKDIR /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Göçler dağıtımda ayrı adım olarak çalıştırılır:  npx prisma migrate deploy
CMD ["node", "dist/main.js"]
