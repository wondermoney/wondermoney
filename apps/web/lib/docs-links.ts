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
