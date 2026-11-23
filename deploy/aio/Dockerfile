# WonderMoney in one container, for NAS app stores (Unraid's Community Applications) and anyone
# who would rather run one container than the docker compose install. It runs Postgres, file
# storage (SeaweedFS), the API, the background worker and the web app behind one port, and keeps
# everything it writes in /config. deploy/aio/README.md has the run command and the settings.
#
# It is assembled from the published images, not built from source, so it is always the same
# code as the compose install of that version. publish-images.yml builds it after them:
#   docker build -f deploy/aio/Dockerfile --build-arg WM_VERSION=1.9.0 .

ARG WM_IMAGE_REGISTRY=ghcr.io/wondermoney
ARG WM_VERSION=latest

FROM ${WM_IMAGE_REGISTRY}/wondermoney-web:${WM_VERSION} AS web

# The S3 store the compose install's `storage` profile runs; `weed` is one static binary.
FROM chrislusf/seaweedfs:4.48 AS seaweedfs

FROM ${WM_IMAGE_REGISTRY}/wondermoney-api:${WM_VERSION}

USER root

# Postgres 16 as in the compose install (contrib for pg_trgm), Caddy as the one front door,
# su-exec to run everything as PUID:PGID, tini as PID 1.
RUN apk add --no-cache bash caddy postgresql16 postgresql16-client postgresql16-contrib su-exec tini

# The web app's standalone server and its start script, which writes the NEXT_PUBLIC_* values in.
COPY --from=web /app /app
COPY --from=web /usr/local/bin/wm-entrypoint /usr/local/bin/wm-web-entrypoint
COPY --from=seaweedfs /usr/bin/weed /usr/local/bin/weed
COPY --chmod=755 deploy/aio/wm-aio.sh /usr/local/bin/wm-aio

# Unraid's convention: nobody:users. Everything in /config belongs to this user.
ENV PUID=99 \
    PGID=100 \
    WM_PORT=3000

VOLUME /config
EXPOSE 3000

# Through the front door, so it fails when any of Caddy, the API or Postgres is down.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${WM_PORT}/v1/health" >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/wm-aio"]
