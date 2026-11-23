# Two generic images from one build, no host assumed:
#   --target home   Quai Home + the console: next to the services, keeps the home's data in /data
#   --target cloud  Quai Cloud: keeps nothing on disk (the default target)
# The build stage runs on the builder's own platform: its output is plain JavaScript, so only the
# small final stage is made per architecture, without emulating the whole build.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/api/package.json packages/api/
COPY apps/home/package.json apps/home/
COPY apps/cloud/package.json apps/cloud/
COPY apps/console/package.json apps/console/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/home apps/home
COPY apps/cloud apps/cloud
COPY apps/console apps/console
ARG QUAI_VERSION=dev
RUN pnpm --filter @quai/home --filter @quai/cloud --filter @quai/console build

FROM node:22-alpine AS home
WORKDIR /app
ARG QUAI_VERSION=dev
ENV NODE_ENV=production \
    QUAI_VERSION=$QUAI_VERSION \
    QUAI_HOME_PORT=8788 \
    QUAI_DATA_DIR=/data \
    QUAI_CONSOLE_DIR=/app/console
COPY --from=build /repo/apps/home/dist/main.js ./main.js
COPY --from=build /repo/apps/console/dist ./console
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8788
HEALTHCHECK CMD wget -qO- http://localhost:8788/health || exit 1
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "main.js"]

FROM node:22-alpine AS cloud
WORKDIR /app
ARG QUAI_VERSION=dev
ENV NODE_ENV=production \
    QUAI_VERSION=$QUAI_VERSION \
    QUAI_PORT=8787
COPY --from=build /repo/apps/cloud/dist/main.js ./main.js
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://localhost:8787/api/health || exit 1
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "main.js"]
