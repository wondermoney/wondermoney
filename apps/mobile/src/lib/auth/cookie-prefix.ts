/**
 * Keep production mobile auth cookies isolated from the default namespace used
 * by local and staging API deployments.
 */
export const getBetterAuthCookiePrefix = (apiBaseUrl: string): string | undefined =>
  apiBaseUrl === 'https://api.wonder.money' ? 'prod.better-auth' : undefined
