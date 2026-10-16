# syntax=docker/dockerfile:1.7
# Multi-stage build: install and build the whole workspace, then ship only the
# bundled server, the static web build and the server's production dependencies.

ARG NODE_IMAGE=node:24.14.1-alpine3.23

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
RUN corepack enable
WORKDIR /repo

# Dependency manifests first, for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/bots/package.json packages/bots/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
# Production-only node_modules for the server (workspace packages are bundled into dist).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @cabo/server deploy --prod /out

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_DIR=/app/web
WORKDIR /app

COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/server/dist ./dist
COPY --from=build --chown=node:node /repo/apps/web/dist ./web

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/readyz || exit 1

CMD ["node", "--enable-source-maps", "dist/index.js"]
