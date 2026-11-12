#!/usr/bin/env bash
# Installs charts/wondermoney into the current Kubernetes context (CI: a kind cluster) and checks
# what the chart promises:
#   - a default install with the bundled Postgres reaches Ready, and `helm test` passes (the API,
#     the web app, and a worker that finishes jobs);
#   - one hostname through an ingress controller (Traefik): /v1 and /api/auth reach the API,
#     everything else the web app;
#   - `helm upgrade` to two hostnames routes each to its own service and keeps the generated
#     secrets byte for byte;
#   - the worker refuses to scale: an upgrade with worker.replicas=2 fails, and one pod runs.
#
#   IMAGE_TAG=1.4.0 .github/scripts/chart-kind-test.sh
#
# IMAGE_TAG picks the images (empty: the chart's appVersion). Leaves the release installed; the
# cluster is for throwaway use.
set -euo pipefail

CHART=charts/wondermoney
NS=wondermoney
RELEASE=wm
TRAEFIK_VERSION=42.3.1
PORT=18080
tag_args=()
[ -n "${IMAGE_TAG:-}" ] && tag_args=(--set "image.tag=$IMAGE_TAG")

say() { printf '\n== %s\n' "$*"; }
fail() { echo "::error::$*"; exit 1; }

# Every workload rolled out and Ready. (`kubectl wait pod --all` would also wait on the pods an
# upgrade is replacing, and hang once they are gone.)
ready() {
  local workload
  for workload in deploy/"$RELEASE"-wondermoney-{api,worker,web} statefulset/"$RELEASE"-wondermoney-postgresql; do
    kubectl -n "$NS" rollout status "$workload" --timeout 5m
  done
  kubectl -n "$NS" get pods
}

say "Traefik, the ingress controller"
helm upgrade --install traefik oci://ghcr.io/traefik/helm/traefik --version "$TRAEFIK_VERSION" \
  -n traefik --create-namespace --set service.spec.type=ClusterIP --wait --timeout 5m

say "Install: bundled Postgres, one hostname"
helm install "$RELEASE" "$CHART" -n "$NS" --create-namespace "${tag_args[@]}" \
  --set postgresql.enabled=true \
  --set ingress.enabled=true --set ingress.className=traefik --set ingress.host=money.example.com \
  --wait --timeout 15m
ready
helm test "$RELEASE" -n "$NS" --logs

kubectl -n traefik port-forward svc/traefik "$PORT:80" >/dev/null 2>&1 &
forward=$!
trap 'kill "$forward" 2>/dev/null || true' EXIT
for _ in $(seq 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 1; done

# The body of a request through the ingress controller, with that Host header.
get() { curl -fsS --max-time 20 -H "Host: $1" "http://127.0.0.1:$PORT$2"; }
# Asserts that a request's body contains a marker: the API answers JSON (/v1/instance carries
# its version, /api/auth/ok an "ok"), the web app HTML.
# The ingress controller picks up an Ingress change a few seconds after `helm --wait` returns,
# and an old pod may still sit behind a Service while it terminates, so each check retries for
# about a minute before failing.
ATTEMPTS=15
expect() {
  local host=$1 path=$2 marker=$3 what=$4 body="" attempt
  for attempt in $(seq "$ATTEMPTS"); do
    body=$(curl -fsS --max-time 10 -H "Host: $host" "http://127.0.0.1:$PORT$path" 2>/dev/null) &&
      grep -qi -- "$marker" <<<"$body" && { echo "$host$path -> $what"; return; }
    [ "$attempt" -lt "$ATTEMPTS" ] && sleep 4
  done
  fail "$host$path did not reach the $what"
}
# The opposite: waits until a request no longer carries the marker.
expect_not() {
  local host=$1 path=$2 marker=$3 attempt
  for attempt in $(seq "$ATTEMPTS"); do
    [[ "$(get "$host" "$path" 2>/dev/null || true)" != *"$marker"* ]] && return
    [ "$attempt" -lt "$ATTEMPTS" ] && sleep 4
  done
  return 1
}
expect_api() { expect "$1" "$2" '"version"' API; }
expect_web() { expect "$1" "$2" '<html' 'web app'; }

say "One hostname routes by path"
expect_api money.example.com /v1/instance
expect money.example.com /api/auth/ok '"ok"' API
expect_web money.example.com /en/auth/login

secret_hash() { kubectl -n "$NS" get secret "$RELEASE-wondermoney-generated" -o json | jq -S .data | sha256sum; }
before=$(secret_hash)

say "Upgrade: two hostnames"
helm upgrade "$RELEASE" "$CHART" -n "$NS" "${tag_args[@]}" --reuse-values \
  --set ingress.apiHost=api.money.example.com \
  --set config.AUTH_COOKIE_DOMAIN=.example.com --set config.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN=.example.com \
  --wait --timeout 10m
ready
expect_api api.money.example.com /v1/instance
expect_web money.example.com /en/auth/login
expect_not money.example.com /v1/instance '"version"' ||
  fail "money.example.com/v1 still reaches the API with two hostnames"
echo "money.example.com/v1 no longer reaches the API"
helm test "$RELEASE" -n "$NS" --logs

after=$(secret_hash)
[ "$before" = "$after" ] || fail "helm upgrade changed the generated secrets"
echo "Generated secrets unchanged by the upgrade: $after"

say "The worker cannot be scaled"
if helm upgrade "$RELEASE" "$CHART" -n "$NS" "${tag_args[@]}" --reuse-values --set worker.replicas=2 2>&1; then
  fail "helm upgrade accepted worker.replicas=2"
fi
replicas=$(kubectl -n "$NS" get deploy "$RELEASE-wondermoney-worker" -o jsonpath='{.spec.replicas}')
[ "$replicas" = 1 ] || fail "the worker has $replicas replicas"
echo "worker.replicas=2 refused; the worker runs $replicas replica."
