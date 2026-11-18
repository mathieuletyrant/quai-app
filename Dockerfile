# Generic Quai image: server + console. No host assumed (Umbrel, Unraid, plain Docker…).
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/api/package.json packages/api/
COPY apps/server/package.json apps/server/
COPY apps/console/package.json apps/console/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/server apps/server
COPY apps/console apps/console
ARG QUAI_VERSION=dev
RUN pnpm --filter @quai/server --filter @quai/console build

FROM node:22-alpine
WORKDIR /app
ARG QUAI_VERSION=dev
ENV NODE_ENV=production \
    QUAI_VERSION=$QUAI_VERSION \
    QUAI_PORT=8787 \
    QUAI_DATA_DIR=/data \
    QUAI_CONSOLE_DIR=/app/console
COPY --from=build /repo/apps/server/dist/main.js ./main.js
COPY --from=build /repo/apps/console/dist ./console
VOLUME /data
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://localhost:8787/api/health || exit 1
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "main.js"]
