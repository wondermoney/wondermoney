import { instanceConfig } from "@/lib/instance";

const docs = instanceConfig.docsUrl;

export const docsLinks = {
  setupPath: `${docs}/en/docs/start-here`,
  accountsTransactions: `${docs}/en/docs/accounts-transactions`,
  understandTransactions: `${docs}/en/docs/accounts-transactions/understand-transactions`,
  envelopeMethod: `${docs}/en/docs/budgets/envelope-method`,
  portfolioMetrics: `${docs}/en/docs/portfolio-investments/portfolio-metrics-explained`,
  glossary: `${docs}/en/docs/glossary`,
} as const;

export type DocsLinkKey = keyof typeof docsLinks;

/** The languages the docs site is written in. */
export type DocsLocale = "en" | "es" | "pt";

/**
 * The docs site's locale for an app locale: the docs are in English, Portuguese and Spanish, so
 * any other app language (Italian) links to the English pages.
 */
export function docsLocaleFor(locale: string): DocsLocale {
  return locale === "pt" || locale === "es" ? locale : "en";
}

export function getDocsLink(key: DocsLinkKey, locale: string) {
  const baseUrl = docsLinks[key];

  if (locale === "pt") {
    return baseUrl.replace("/en/docs/", "/pt-PT/docs/");
  }

  if (locale === "en") {
    return baseUrl;
  }

  return baseUrl;
}
