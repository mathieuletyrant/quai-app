# The demo home for App Review: the preview server (apps/cloud/test/preview.ts), the real Quai
# Cloud linked in memory to a fake Quai Home answering from the recorded fixtures, dates moved to
# today. No APNs key: no Live Activity, no notification. Nothing is kept: a restart starts over.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/api/package.json packages/api/
COPY apps/cloud/package.json apps/cloud/
RUN pnpm install --frozen-lockfile --filter @quai/cloud...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/cloud apps/cloud
RUN pnpm --filter @quai/cloud build:demo

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    QUAI_PORT=8787 \
    NODE_OPTIONS="--max-old-space-size=160 --max-semi-space-size=8"
COPY --from=build /repo/apps/cloud/dist/demo.js ./demo.js
# The fixtures are read next to the bundle, as `./fixtures/...` from it.
COPY --from=build /repo/apps/cloud/test/fixtures ./fixtures
EXPOSE 8787
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "demo.js"]
