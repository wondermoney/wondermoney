/**
 * Production API uses an isolated Better Auth cookie namespace so old default
 * cookies cannot be mistaken for production sessions. Staging and local API
 * origins intentionally retain Better Auth's default namespace.
 */
export function getBetterAuthCookiePrefix(apiUrl?: string): string | undefined {
  if (!apiUrl) return undefined;

  try {
    return new URL(apiUrl).origin === "https://api.wonder.money"
      ? "prod.better-auth"
      : undefined;
  } catch {
    return undefined;
  }
}
