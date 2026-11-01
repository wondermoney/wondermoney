/**
 * Instance-specific settings for the web app, from `NEXT_PUBLIC_*` variables.
 *
 * Unset variables mean the feature is off: no legal links (the sign-up page then shows no
 * agreement), no demo account, a host-only auth cookie, no error tracking and none of the
 * hosted service's announcements. The project's public docs stay the default help link.
 *
 * What the API decides (Google sign-in, the support address) comes from `GET /v1/instance`
 * instead: see `lib/api/instance/useInstance.ts`.
 */

type Env = Readonly<Record<string, string | undefined>>;

const PUBLIC_DOCS_URL = "https://docs.wonder.money";

export interface InstanceConfig {
  /** Host of the web app, for display. */
  appHost: string;
  /** `Domain` attribute of the auth cookie; `undefined` is a host-only cookie. */
  cookieDomain: string | undefined;
  /** The shared read-only demo account, if this instance has one. */
  demoEmail: null | string;
  docsUrl: string;
  privacyUrl: null | string;
  sentryDsn: null | string;
  /**
   * The announcement of the hosted service's move to free and open source. It concerns
   * wonder.money's own users, so only that deploy sets `NEXT_PUBLIC_SHOW_PIVOT_BANNER`.
   */
  showPivotBanner: boolean;
  termsUrl: null | string;
}

const read = (env: Env, key: string): null | string => env[key]?.trim().replace(/\/+$/u, "") || null;

const flag = (env: Env, key: string): boolean => ["1", "true", "yes", "on"].includes(read(env, key)?.toLowerCase() ?? "");

function hostOf(url: null | string): string {
  if (!url) return "localhost";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function resolveInstanceConfig(env: Env): InstanceConfig {
  const apiUrl = read(env, "NEXT_PUBLIC_API_URL");
  const appUrl = read(env, "NEXT_PUBLIC_APP_URL");
  const isLocal = hostOf(appUrl ?? apiUrl).startsWith("localhost");

  return {
    appHost: hostOf(appUrl),
    cookieDomain: read(env, "NEXT_PUBLIC_AUTH_COOKIE_DOMAIN") ?? (isLocal ? "localhost" : undefined),
    demoEmail: read(env, "NEXT_PUBLIC_DEMO_EMAIL"),
    docsUrl: read(env, "NEXT_PUBLIC_DOCS_URL") ?? PUBLIC_DOCS_URL,
    privacyUrl: read(env, "NEXT_PUBLIC_PRIVACY_URL"),
    sentryDsn: read(env, "NEXT_PUBLIC_SENTRY_DSN"),
    showPivotBanner: flag(env, "NEXT_PUBLIC_SHOW_PIVOT_BANNER"),
    termsUrl: read(env, "NEXT_PUBLIC_TERMS_URL"),
  };
}

/**
 * `NEXT_PUBLIC_*` values are inlined at build time, so each must be read by its literal name
 * for Next.js to substitute it.
 */
export const instanceConfig: InstanceConfig = resolveInstanceConfig({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN,
  NEXT_PUBLIC_DEMO_EMAIL: process.env.NEXT_PUBLIC_DEMO_EMAIL,
  NEXT_PUBLIC_DOCS_URL: process.env.NEXT_PUBLIC_DOCS_URL,
  NEXT_PUBLIC_PRIVACY_URL: process.env.NEXT_PUBLIC_PRIVACY_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_SHOW_PIVOT_BANNER: process.env.NEXT_PUBLIC_SHOW_PIVOT_BANNER,
  NEXT_PUBLIC_TERMS_URL: process.env.NEXT_PUBLIC_TERMS_URL,
});
