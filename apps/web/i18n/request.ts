import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  // Typically corresponds to the `[locale]` segment
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const messages = {
    ...(await import(`../messages/${locale}/common.json`)).default,
    ...(await import(`../messages/${locale}/categories.json`)).default,
    ...(await import(`../messages/${locale}/navigation.json`)).default,
    ...(await import(`../messages/${locale}/onboarding.json`)).default,
    ...(await import(`../messages/${locale}/household.json`)).default,
    ...(await import(`../messages/${locale}/reports.json`)).default,
    ...(await import(`../messages/${locale}/loans.json`)).default,
  };

  return { locale, messages };
});
