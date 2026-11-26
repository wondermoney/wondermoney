import type { Lang } from "@/lib/i18nLocale";

/**
 * Links to the WonderMoney apps: the hosted web app and the store listings.
 *
 * The web app prefixes every route with its language, and a prefix in the link wins over the
 * app's language cookie and the browser's language, so every link into it carries the page's
 * language, or English where the app has no translation.
 */

/** The hosted web app. */
export const WEB_APP_URL = "https://app.wonder.money";

/** Languages the hosted app is translated into: the locales of `apps/web/i18n/routing.ts`. */
export const APP_LANGS = ["en", "pt", "es", "it"] as const satisfies ReadonlyArray<Lang>;

export type AppLang = (typeof APP_LANGS)[number];

/** The app's language for a page of the site, which has route trees the app has no translation for. */
export function appLang(locale: Lang): AppLang {
  return (APP_LANGS as ReadonlyArray<Lang>).includes(locale) ? (locale as AppLang) : "en";
}

const appUrl = (locale: Lang, path: string): string => `${WEB_APP_URL}/${appLang(locale)}${path}`;

const SIGNUP_PATH = "/auth/signup";

/** Sign-up on the hosted instance: every primary CTA on the site. */
export function appSignupUrl(locale: Lang): string {
  return appUrl(locale, SIGNUP_PATH);
}

/**
 * Whether `url` is the app's sign-up in one of its languages: the links the signup attribution
 * (`landingSource.ts`) decorates.
 */
export function isAppSignupUrl(url: URL): boolean {
  return url.origin === WEB_APP_URL && APP_LANGS.some((lang) => url.pathname === `/${lang}${SIGNUP_PATH}`);
}

/**
 * The read-only demo on the hosted instance. The app starts the demo session when its sign-in
 * page opens with `?demo=1`: the session cookie has to be set from the app's own origin, so
 * this site can only link there. A visitor already signed in goes straight into the app.
 */
export function appDemoUrl(locale: Lang): string {
  return appUrl(locale, "/auth/login?demo=1");
}

/**
 * Sign-in for a returning person, with no language: the app opens in the language its cookie
 * remembers from their last visit, or the browser's.
 */
export const APP_LOGIN_URL = `${WEB_APP_URL}/auth/login`;

/**
 * The hosted app's FAQ. The app redirects an unprefixed `/faq` by the browser's language, not
 * the page's.
 */
export function appFaqUrl(locale: Lang): string {
  return appUrl(locale, "/faq");
}

/**
 * The WonderMoney app's store listings (bundle and package id `money.wonder.app`,
 * `apps/mobile/app.config.ts`; App Store id from `apps/mobile/eas.json`). The App Store link has
 * no country, so Apple opens the visitor's own store.
 */
export const APP_STORE_URL = "https://apps.apple.com/app/id6800748899";
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=money.wonder.app";
