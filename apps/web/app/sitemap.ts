import { MetadataRoute } from "next";
import { Locale } from "next-intl";

import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getBaseUrl } from "@/lib/utils/url";

// Adapt this as necessary
const host = getBaseUrl();

export default function sitemap(): MetadataRoute.Sitemap {
  // Adapt this as necessary
  return [
    ...getEntries("/"),
    ...getEntries("/accounts"),
    ...getEntries("/accounts/transactions"),
    ...getEntries("/accounts/transactions/review"),
    ...getEntries("/auth/login"),
    ...getEntries("/auth/signup"),
    ...getEntries("/auth/forgot"),
    ...getEntries("/auth/reset"),
    ...getEntries("/auth/mfa"),
    ...getEntries("/budgets"),
    ...getEntries("/budgets/wizard"),
    ...getEntries("/faq"),
    ...getEntries("/reports"),
    ...getEntries("/settings"),
  ];
}

type Href = Parameters<typeof getPathname>[0]["href"];

function getEntries(href: Href) {
  return routing.locales.map((locale) => ({
    url: getUrl(href, locale),
    alternates: {
      languages: Object.fromEntries(
        routing.locales.map((cur) => [cur, getUrl(href, cur)]),
      ),
    },
  }));
}

function getUrl(href: Href, locale: Locale) {
  const pathname = getPathname({ locale, href });
  return host + pathname;
}
