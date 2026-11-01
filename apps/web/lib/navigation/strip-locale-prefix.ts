import { routing } from "@/i18n/routing";

/**
 * Removes a leading locale segment from a path.
 *
 * `next` is stored already localised (`/en/settings`, straight off the
 * query string), but the final navigation goes through next-intl's router from
 * `@/i18n/navigation`, which *prepends* the active locale. The two combined
 * would produce `/en/en/settings` — a 404 — for anyone logging in with a `next`
 * destination: a session-expiry re-login, an email deep link, a shared
 * household URL.
 *
 * Only a segment that is actually one of the configured locales is stripped, so
 * a genuine first segment survives: `/settings` and `/entries` are returned
 * unchanged.
 *
 * Use this on any value that originates in a URL before handing it to the
 * localised router. Values that are already unlocalised pass through untouched,
 * so it is safe to apply defensively.
 */
export function stripLocalePrefix(path: string): string {
  if (!path.startsWith("/")) return path;

  const match = /^\/([^/?#]+)($|[/?#].*)/.exec(path);
  if (!match) return path;

  const [, first, rest] = match;
  if (!(routing.locales as readonly string[]).includes(first!)) return path;

  // "/en" -> "/", "/en/settings" -> "/settings", "/en?tab=x" -> "/?tab=x"
  if (!rest) return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}
