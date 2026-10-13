import { routing } from "@/i18n/routing";

import { getBaseUrl } from "../utils/url";

export function resolveAuthLocale(locale: string) {
  return routing.locales.includes(locale as (typeof routing.locales)[number])
    ? locale
    : routing.defaultLocale;
}

export function deriveAuthLocaleFromPathname(pathname: string) {
  return resolveAuthLocale(pathname.split("/")[1] ?? "");
}

export function buildLocalizedAuthCompletePath(locale: string) {
  return `/${resolveAuthLocale(locale)}/auth/complete`;
}

export function buildLocalizedAuthErrorPath(locale: string) {
  return `/${resolveAuthLocale(locale)}/auth/auth-code-error`;
}

export function buildLocalizedLoginPath(locale: string) {
  return `/${resolveAuthLocale(locale)}/auth/login`;
}

export function buildSafeAuthOrigin(_requestOrigin: string) {
  const configuredOrigin = getBaseUrl().replace(/\/$/, ""); // Remove trailing slash if present
  if (
    configuredOrigin &&
    configuredOrigin !== "undefined" &&
    configuredOrigin !== "null"
  ) {
    return configuredOrigin;
  }

  return "";
}

export function sanitizeNextPath(next: string | null) {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  ) {
    return "/";
  }

  return next;
}
