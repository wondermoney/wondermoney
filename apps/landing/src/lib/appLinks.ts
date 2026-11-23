import type { Lang } from "@/lib/i18nLocale";

/** Languages app.wonder.money is translated into; it prefixes every route with one of them. */
const APP_LANGS: ReadonlyArray<Lang> = ["en", "pt", "es"];

/**
 * The hosted app's FAQ in the page's language, or English where the app has no translation.
 * The app redirects an unprefixed `/faq` by the browser's language, not the page's.
 */
export function appFaqUrl(locale: Lang): string {
  const lang = APP_LANGS.includes(locale) ? locale : "en";
  return `https://app.wonder.money/${lang}/faq`;
}
