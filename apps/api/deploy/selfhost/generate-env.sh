#!/bin/sh
# Creates .env from .env.example with a fresh value for every GENERATED secret.
# Refuses to overwrite an existing .env: regenerating CREDENTIAL_ENCRYPTION_KEY_V1 would make
# every stored bank credential unreadable.
set -eu
cd "$(dirname "$0")"

if [ -e .env ]; then
  echo ".env already exists; not touching it." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "openssl is required." >&2; exit 1; }

cp .env.example .env
for key in POSTGRES_PASSWORD BETTER_AUTH_SECRET EMAIL_OPT_OUT_SIGNING_SECRET ADMIN_API_KEY INTERNAL_SERVICE_API_KEY; do
  value=$(openssl rand -hex 32)
  sed -i.bak "s|^$key=GENERATED$|$key=$value|" .env
done
# Must be base64 decoding to exactly 32 bytes.
key=$(openssl rand -base64 32)
sed -i.bak "s|^CREDENTIAL_ENCRYPTION_KEY_V1=GENERATED$|CREDENTIAL_ENCRYPTION_KEY_V1=$key|" .env
rm -f .env.bak
chmod 600 .env

echo "Created .env. Review APP_URL and API_URL, then: docker compose up -d"
