import type { Lang } from "@/lib/i18nLocale";

/** The public repository. */
export const GITHUB_URL = "https://github.com/wondermoney/wondermoney";

/** Languages docs.wonder.money is written in; the rest read the English guide. */
const DOCS_LANGS: ReadonlyArray<Lang> = ["en", "pt", "es"];

/** The self-hosting guide on docs.wonder.money, in the page's language when the docs have it. */
export function selfHostingDocsUrl(locale: Lang): string {
  const lang = DOCS_LANGS.includes(locale) ? locale : "en";
  return `https://docs.wonder.money/${lang}/docs/self-hosting`;
}
