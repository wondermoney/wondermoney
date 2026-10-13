#!/bin/sh
# Next.js inlines NEXT_PUBLIC_* values into the bundle at build time. This image is built with
# placeholders instead (see Dockerfile), and this script writes the container's real values in
# before the server starts, so one image serves any instance. An unset variable becomes "",
# which lib/utils/env.ts and lib/instance.ts treat as not set.
set -eu

replace() {
  placeholder="$1"
  value="$2"
  # Escape the characters sed treats specially in a replacement.
  escaped=$(printf '%s' "$value" | sed -e 's/[\\&|]/\\&/g')
  find /app/apps/web/.next /app/apps/web/server.js -type f \( -name '*.js' -o -name '*.json' -o -name '*.html' -o -name '*.rsc' -o -name '*.body' \) \
    -exec grep -l "$placeholder" {} + 2>/dev/null \
    | xargs -r sed -i "s|$placeholder|$escaped|g"
}

: "${NEXT_PUBLIC_API_URL:?NEXT_PUBLIC_API_URL must be set to the API address, e.g. https://api.example.com}"
: "${NEXT_PUBLIC_APP_URL:?NEXT_PUBLIC_APP_URL must be set to this web app address, e.g. https://money.example.com}"

# URL variables are built as valid placeholder URLs, so build-time validation passes.
replace "https://wm-runtime-next-public-api-url.invalid" "${NEXT_PUBLIC_API_URL%/}"
replace "https://wm-runtime-next-public-app-url.invalid" "${NEXT_PUBLIC_APP_URL%/}"

for name in NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN NEXT_PUBLIC_AUTH_COOKIE_DOMAIN NEXT_PUBLIC_DEMO_EMAIL \
  NEXT_PUBLIC_DOCS_URL NEXT_PUBLIC_POSTHOG_KEY NEXT_PUBLIC_PRIVACY_URL NEXT_PUBLIC_RECAPTCHA_SITE_KEY \
  NEXT_PUBLIC_SENTRY_DSN NEXT_PUBLIC_TERMS_URL; do
  eval "value=\${$name:-}"
  replace "__WM_RUNTIME_${name}__" "$value"
done

exec node /app/apps/web/server.js
