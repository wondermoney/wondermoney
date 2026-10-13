# Base image pinned by digest for reproducible builds. Dependabot's `docker`
# ecosystem (.github/dependabot.yml) opens a monthly PR to bump it.
# node:22-alpine as of 2026-09-15.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder

# NOTE: no native build toolchain is installed here on purpose.
# This stage used to `apk add build-base g++ cairo-dev jpeg-dev pango-dev
# giflib-dev` "for canvas". There is no `canvas` package in the tree: `pdf-to-img`
# depends on `pdfjs-dist@5`, which uses `@napi-rs/canvas` — a *prebuilt* native
# binary that needs no cairo/pango headers and no compiler. The toolchain was a
# multi-minute apk install on every cache miss for nothing. If a dependency ever
# genuinely needs to compile against cairo, add it back with a comment naming it.

# Build context is the monorepo root: `docker build -f apps/api/Dockerfile .`
WORKDIR /repo
RUN corepack enable

# Lockfile and manifests first, so the dependency layer is cached across source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/react-email/package.json packages/react-email/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --filter @wondermoney/api...

COPY apps/api apps/api
COPY packages/shared packages/shared
COPY packages/react-email packages/react-email

# Stamped into GITHUB_SHA (src/utils/constants.ts); it also marks the build as deployed
# for Sentry. Self-hosted builds can leave it unset.
ARG GIT_COMMIT_SHA=
RUN if [ -n "$GIT_COMMIT_SHA" ]; then \
      sed -i "s/##REPLACE_GITHUB_COMMIT_SHA_HERE##/${GIT_COMMIT_SHA}/" apps/api/src/utils/constants.ts; \
    fi

RUN pnpm --filter @wondermoney/shared --filter @wondermoney/react-email run build:lib \
  && pnpm --filter @wondermoney/api run build

# Production dependencies only, in the same monorepo layout: the hoisted node_modules at
# the root, any version-conflicting copies under apps/api, and the workspace packages
# (linked from node_modules/@wondermoney) with just their build output.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS prod-deps
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/react-email/package.json packages/react-email/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --prod --ignore-scripts --filter @wondermoney/api... \
  && mkdir -p apps/api/node_modules
COPY --from=builder /repo/packages/shared/dist packages/shared/dist
COPY --from=builder /repo/packages/react-email/dist packages/react-email/dist

# node-prune strips docs/tests/typings out of node_modules.
#
# This is a third-party Docker Hub image that is handed the entire production
# `node_modules` tree with read and write access, so it was pulled at `:latest`
# — meaning whoever controls that repo could silently alter what ships. It is now
# pinned by digest (softonic/node-prune:latest as of 2026-09-15); Dependabot's
# `docker` ecosystem will propose digest bumps that a human can review.
#
# Measured on 2026-09-15 with @sentry/cli, swagger-autogen and cross-env already
# out of the production closure: node_modules 497 MB -> 365 MB. That 132 MB is why
# the stage survives rather than being deleted outright. Note the image is
# amd64-only, which is fine on CI but warns on an arm64 laptop.
FROM softonic/node-prune:latest@sha256:468f604c94b81f07fc79e15fa7fdd22f0ac826b7f412708ac6c5b148f71f1df8 AS pruner

COPY --from=prod-deps /repo/node_modules /home/node/app/node_modules

RUN node-prune /home/node/app/node_modules

# Start production image build
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runtime-base

ARG APP_ENV=production
ARG DEPLOY_ENV=${APP_ENV}
ENV APP_ENV=${APP_ENV}
ENV DEPLOY_ENV=${DEPLOY_ENV}
# The app refuses to start without NODE_ENV and PORT; deployments may still override them.
ENV NODE_ENV=production
ENV PORT=3001

# `curl` is for the container health check, not the app — and it is a cosmetic
# fix, not a correctness one. Coolify generates a `curl ... || wget ...` check on
# all four apps (prod/staging x api/worker, all `custom_healthcheck_found:
# false`). curl was absent from this image, so every attempt printed
# `/bin/sh: curl: not found` before falling through to busybox wget, which alpine
# does ship. The check worked: deploy logs show it correctly returning 1 while
# the app was still booting and 0 once it served.
#
# The error line was pure noise, but noise that reads exactly like a broken
# health check — it cost real time to rule out. Installing curl lets the first
# branch succeed and keeps deploy logs honest. If the ~1.5MB is ever worth
# reclaiming, dropping this and relying on wget is perfectly safe.
#
# Endpoints, for reference: the API serves /v1/health and the worker serves
# /health and /v1/health from `worker-health.ts`, both on the exposed port 3001.
#
# The cairo/jpeg/pango/giflib runtime libraries that used to be installed here
# were removed with the builder toolchain above — nothing in the tree links
# against them (see the builder-stage note).
RUN apk add --no-cache curl

WORKDIR /home/node/app

RUN mkdir -p /home/node/app \
  && chown -R node:node /home/node/app

USER node

# Copy node modules and build directory
COPY --from=pruner --chown=node:node /home/node/app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /repo/packages ./packages
COPY --from=prod-deps --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /repo/apps/api/src/generated ./apps/api/dist/generated
COPY --from=builder --chown=node:node /repo/apps/api/src/database/entity ./apps/api/dist/database/entity

WORKDIR /home/node/app/apps/api

EXPOSE 3001

# Coolify generates its own health check externally, so this is mostly for
# `docker run` / `docker compose` parity and to keep the health contract in the
# repo. `start-period` is generous because the api target runs migrations before
# it starts listening (see the api CMD below).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT:-3001}/v1/health" || exit 1

FROM runtime-base AS worker

CMD ["node", "dist/worker.js"]

FROM runtime-base AS api

CMD ["sh", "-c", "node dist/migrate.js && exec node dist/server.js"]
