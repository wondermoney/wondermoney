# Production image for self-hosting. Built once, configured at run time: NEXT_PUBLIC_* values
# are compiled in as placeholders and docker/entrypoint.sh writes the container's values over
# them on start (recreate the container to change them). Dockerfile.local is the dev server.
#
# Build context is the monorepo root: `docker build -f apps/web/Dockerfile .`

FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS builder
WORKDIR /repo
# Node 25+ no longer bundles corepack, so install it (pinned) before enabling it; it then
# provides the pnpm version in the root package.json's packageManager field.
RUN npm install -g corepack@0.36.0 && corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .pnpmfile.cjs ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @wondermoney/web...
COPY apps/web apps/web
# The web app imports @wondermoney/shared/decimal as TypeScript source (no build step).
COPY packages/shared packages/shared
# Shown next to the version in the app (next.config.ts); publish-images passes both.
# WM_VERSION is the release tag's version (1.2.0 for v1.2.0); unset, the build reports "dev".
ARG GIT_COMMIT_SHA=""
ARG WM_VERSION=""
ENV WM_VERSION=$WM_VERSION \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone \
    NODE_ENV=production \
    NEXT_PUBLIC_API_URL=https://wm-runtime-next-public-api-url.invalid \
    NEXT_PUBLIC_APP_URL=https://wm-runtime-next-public-app-url.invalid \
    NEXT_PUBLIC_AUTH_COOKIE_DOMAIN=__WM_RUNTIME_NEXT_PUBLIC_AUTH_COOKIE_DOMAIN__ \
    NEXT_PUBLIC_DEMO_EMAIL=__WM_RUNTIME_NEXT_PUBLIC_DEMO_EMAIL__ \
    NEXT_PUBLIC_DOCS_URL=__WM_RUNTIME_NEXT_PUBLIC_DOCS_URL__ \
    NEXT_PUBLIC_GTM_ID=__WM_RUNTIME_NEXT_PUBLIC_GTM_ID__ \
    NEXT_PUBLIC_POSTHOG_KEY=__WM_RUNTIME_NEXT_PUBLIC_POSTHOG_KEY__ \
    NEXT_PUBLIC_PRIVACY_URL=__WM_RUNTIME_NEXT_PUBLIC_PRIVACY_URL__ \
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY=__WM_RUNTIME_NEXT_PUBLIC_RECAPTCHA_SITE_KEY__ \
    NEXT_PUBLIC_SENTRY_DSN=__WM_RUNTIME_NEXT_PUBLIC_SENTRY_DSN__ \
    NEXT_PUBLIC_TERMS_URL=__WM_RUNTIME_NEXT_PUBLIC_TERMS_URL__
RUN pnpm --filter @wondermoney/web run build

FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --chown=node:node apps/web/docker/entrypoint.sh /usr/local/bin/wm-entrypoint
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null || exit 1
ENTRYPOINT ["wm-entrypoint"]
