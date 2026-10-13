import { routing } from "@/i18n/routing";

const FALLBACK_LOCALE = "en";

export function buildOnboardingConnectRedirectPage(locale: string): string {
  const cleaned = (locale ?? "").replace(/^\/+/, "").trim();
  const safeLocale = (routing.locales as readonly string[]).includes(cleaned)
    ? cleaned
    : FALLBACK_LOCALE;
  return `${safeLocale}/onboarding/sync`;
}
