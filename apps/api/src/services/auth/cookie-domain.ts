/**
 * The `Domain` attribute of better-auth's session cookie.
 *
 * A cookie domain exists for one reason: the web app and the API on different hostnames
 * (`money.example.com` and `api.money.example.com`) must share one session cookie. When both
 * live on the same hostname — the one-hostname self-hosting setup, where the proxy routes
 * `/v1/*` and `/api/auth/*` to the API and everything else to the web app — a host-only cookie
 * is already sent to every path, so a configured domain is ignored: it would only widen the
 * session cookie to sibling subdomains.
 */
export function resolveAuthCookieDomain(
  configuredDomain: null | string | undefined,
  instance: { apiUrl: string; appUrl: string },
): null | string {
  const domain = configuredDomain?.trim();
  if (!domain) return null;

  const apiHost = hostnameOf(instance.apiUrl);
  const appHost = hostnameOf(instance.appUrl);
  if (!apiHost || !appHost) return domain;

  return apiHost === appHost ? null : domain;
}

function hostnameOf(url: string): null | string {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}
