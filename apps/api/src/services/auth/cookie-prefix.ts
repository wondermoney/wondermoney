const HOSTED_PRODUCTION_API_ORIGIN = 'https://api.wonder.money';

/**
 * better-auth's cookie name prefix. The hosted production API uses an isolated
 * `prod.better-auth` namespace so stale default-named cookies on the shared parent domain can
 * never pass for production sessions; web and mobile expect that prefix only from that origin
 * (`web/lib/auth/cookie-prefix.ts`, `mobile/src/lib/auth/cookie-prefix.ts`). Every other server,
 * including a self-hosted one in production, keeps better-auth's default, which is what its
 * clients look for. `AUTH_COOKIE_PREFIX` overrides both.
 */
export function resolveAuthCookiePrefix(
  env: Readonly<Record<string, string | undefined>>,
  instance: { apiUrl: string; isProduction: boolean },
): string | undefined {
  const explicit = env['AUTH_COOKIE_PREFIX']?.trim();
  if (explicit) return explicit;
  const isHostedProduction = instance.isProduction && safeOrigin(instance.apiUrl) === HOSTED_PRODUCTION_API_ORIGIN;
  return isHostedProduction ? 'prod.better-auth' : undefined;
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
