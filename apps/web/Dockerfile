# Production image for self-hosting. Built once, configured at run time: NEXT_PUBLIC_* values
# are compiled in as placeholders and docker/entrypoint.sh writes the container's values over
# them on start (recreate the container to change them). Dockerfile.local is the dev server.
#
# Build context is the monorepo root: `docker build -f apps/web/Dockerfile .`

FROM node:24-alpine AS builder
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @wondermoney/web...
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone \
    NODE_ENV=production \
    NEXT_PUBLIC_API_URL=https://wm-runtime-next-public-api-url.invalid \
    NEXT_PUBLIC_APP_URL=https://wm-runtime-next-public-app-url.invalid \
    NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN=__WM_RUNTIME_NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN__ \
    NEXT_PUBLIC_AUTH_COOKIE_DOMAIN=__WM_RUNTIME_NEXT_PUBLIC_AUTH_COOKIE_DOMAIN__ \
    NEXT_PUBLIC_DEMO_EMAIL=__WM_RUNTIME_NEXT_PUBLIC_DEMO_EMAIL__ \
    NEXT_PUBLIC_DOCS_URL=__WM_RUNTIME_NEXT_PUBLIC_DOCS_URL__ \
    NEXT_PUBLIC_POSTHOG_KEY=__WM_RUNTIME_NEXT_PUBLIC_POSTHOG_KEY__ \
    NEXT_PUBLIC_PRIVACY_URL=__WM_RUNTIME_NEXT_PUBLIC_PRIVACY_URL__ \
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY=__WM_RUNTIME_NEXT_PUBLIC_RECAPTCHA_SITE_KEY__ \
    NEXT_PUBLIC_SENTRY_DSN=__WM_RUNTIME_NEXT_PUBLIC_SENTRY_DSN__ \
    NEXT_PUBLIC_TERMS_URL=__WM_RUNTIME_NEXT_PUBLIC_TERMS_URL__
RUN pnpm --filter @wondermoney/web run build

FROM node:24-alpine AS runner
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
