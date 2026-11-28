#!/usr/bin/env bash
# Deploys one Coolify Docker-image application at a given image tag and waits for the deployment
# to finish. api-production.yml runs it for the API and the worker.
#
#   DEPLOY_API_BASE=<coolify base URL> COOLIFY_TOKEN=<token> \
#     .github/scripts/coolify-deploy.sh <application uuid> <image tag> [<label>]
#
# It sets the application's Docker image tag (PATCH /applications/{uuid}), checks that Coolify
# kept it, starts a deployment (POST /deploy) and polls it until Coolify reports it finished.
#
# Why the tag is set on every deploy (#766): when Coolify cannot pull a Docker-image
# application's image, it starts the image already on the server under that tag and still
# reports the deployment finished (Coolify 4.7.7 and later). Under a moving tag such as :master
# that is the previous release. A tag that names the commit has no older image behind it, so
# the deployment either starts the image built for the commit or fails.
#
# The token needs Coolify's read, write and deploy permissions (write for the PATCH). Prints
# deployment_uuid=<uuid> to $GITHUB_OUTPUT when that is set.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <application uuid> <image tag> [<label>]" >&2
  exit 2
fi
app_uuid=$1
image_tag=$2
label=${3:-application}
: "${DEPLOY_API_BASE:?DEPLOY_API_BASE is not set}"
: "${COOLIFY_TOKEN:?COOLIFY_TOKEN is not set}"
api="${DEPLOY_API_BASE%/}/api/v1"
auth=(-H "Authorization: Bearer ${COOLIFY_TOKEN}")
# Seconds between status polls, and how many polls before giving up (10 minutes by default).
poll_seconds=${COOLIFY_POLL_SECONDS:-10}
poll_count=${COOLIFY_POLL_COUNT:-60}

# 1. Point the application at the image tag of this commit.
body=$(jq -cn --arg tag "$image_tag" '{docker_registry_image_tag: $tag}')
if ! response=$(curl -sS --fail-with-body -X PATCH "${api}/applications/${app_uuid}" "${auth[@]}" \
  -H 'Content-Type: application/json' --data "$body"); then
  echo "::error::Could not set the ${label} image tag to ${image_tag}: ${response}. The Coolify token needs the write permission." >&2
  exit 1
fi

# The tag only decides what runs for a Docker-image application, so check both.
if ! app=$(curl -sS --fail-with-body "${api}/applications/${app_uuid}" "${auth[@]}"); then
  echo "::error::Could not read the ${label} application back from Coolify: ${app}" >&2
  exit 1
fi
build_pack=$(jq -r '.build_pack // empty' <<<"$app")
saved_tag=$(jq -r '.docker_registry_image_tag // empty' <<<"$app")
image_name=$(jq -r '.docker_registry_image_name // empty' <<<"$app")
if [ "$build_pack" != "dockerimage" ]; then
  echo "::error::The ${label} application is not a Docker-image application in Coolify (build pack: ${build_pack:-unknown}), so its image tag does not decide what it runs." >&2
  exit 1
fi
if [ "$saved_tag" != "$image_tag" ]; then
  echo "::error::Coolify kept the ${label} image tag at ${saved_tag:-empty} instead of ${image_tag}." >&2
  exit 1
fi
echo "${label}: deploying ${image_name}:${image_tag}"

# 2. Deploy it. force only turns off the build cache of build packs that build; a Docker-image
# deployment pulls its image either way.
if ! response=$(curl -sS --fail-with-body -X POST "${api}/deploy?uuid=${app_uuid}&force=false" "${auth[@]}"); then
  echo "::error::Coolify refused the ${label} deployment: ${response}" >&2
  exit 1
fi
echo "$response"
deployment_uuid=$(jq -r '.deployments[0].deployment_uuid // empty' <<<"$response")
if [ -z "$deployment_uuid" ]; then
  echo "::error::Could not read the deployment_uuid from Coolify's /deploy response: $response" >&2
  exit 1
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "deployment_uuid=${deployment_uuid}" >> "$GITHUB_OUTPUT"
fi

# 3. Wait for it. Coolify marks the deployment failed when the image cannot be pulled (the tag
# is new to the server) or the new container fails its health check; the old container keeps
# running then.
status=""
for _ in $(seq 1 "$poll_count"); do
  status=$(curl -sS "${api}/deployments/${deployment_uuid}" "${auth[@]}" | jq -r '.status // empty' || true)
  echo "${label} deployment status: ${status:-unknown}"
  case "$status" in
    finished) exit 0 ;;
    failed | cancelled-by-user)
      echo "::error::The ${label} deployment ${deployment_uuid} ended with status ${status}. Its log in Coolify tells why; when the image pull failed, check that the server can resolve and reach ghcr.io (on 27 Nov 2026 its DNS timed out) and its registry login (Server > Docker Registries)." >&2
      exit 1
      ;;
  esac
  sleep "$poll_seconds"
done
echo "::error::The ${label} deployment ${deployment_uuid} did not finish within $((poll_count * poll_seconds)) seconds (last status: ${status:-unknown})." >&2
exit 1
