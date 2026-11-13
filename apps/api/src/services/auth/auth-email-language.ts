import { SupportedLanguages } from '@entity/Appuser';
import { accountLocale } from '@utils/account-language';
import logger from '@utils/logger';
import { mapRouteLocaleToEmailLanguage, SIGNUP_ROUTE_LOCALES, type SignupRouteLocale } from '@validators/auth';

/** The account language of a better-auth user, by its id and then its address; null when none. */
export type AccountLanguageLookup = (user: { email: string; id: string }) => Promise<null | string | undefined>;

const LANGUAGES: readonly SupportedLanguages[] = Object.values(SupportedLanguages);

/**
 * The language of the emails better-auth sends (password reset, email verification), and the
 * locale of the app page their link lands on.
 *
 * The account's own language (`Appuser.language`) wins. An email/password sign-up is mailed its
 * verification link before the auth callback creates the account, so then the language comes from
 * the page the request started on: the locale segment of the link's app `callbackURL` (the web
 * sign-up and forgot-password forms send one), which is the locale the callback records too.
 * With neither, English.
 *
 * Nothing here may throw: better-auth sends these emails only when the address has an account,
 * and an error that only an existing address can produce would tell a stranger which addresses
 * are registered. A failed lookup reads as English.
 */
export async function authEmailLanguage(
  input: { appUrl: string; link: string; user: { email: string; id: string } },
  lookup: AccountLanguageLookup,
): Promise<SupportedLanguages | undefined> {
  try {
    const stored = await lookup(input.user);
    const language = LANGUAGES.find((known) => known === stored);
    if (language) return language;
  } catch (error) {
    logger.warn({ errorType: error instanceof Error ? error.constructor.name : typeof error }, 'Account language lookup for an auth email failed; using the page locale');
  }
  const pageLocale = callbackLocale(input.link, input.appUrl);
  return pageLocale ? mapRouteLocaleToEmailLanguage(pageLocale) : undefined;
}

/**
 * The link with its app `callbackURL` moved to the account's locale (`/en/auth/reset` →
 * `/pt/auth/reset`), so a person lands in the language their email is in. Only a callback on the
 * web app whose path starts with a locale changes; anything else (the mobile app's scheme, a
 * path without a locale) is left as it is, and so is everything outside `callbackURL`, the token
 * included.
 */
export function linkInAccountLocale(link: string, appUrl: string, language: SupportedLanguages): string {
  const url = parse(link);
  const callback = url?.searchParams.get('callbackURL');
  const parts = callback ? appCallbackParts(callback, appUrl) : undefined;
  if (!url || !parts) return link;
  const locale = accountLocale(language);
  if (parts.locale === locale) return link;
  url.searchParams.set('callbackURL', `${parts.base}/${locale}${parts.rest}`);
  return url.toString();
}

/** The web locale a link's app `callbackURL` starts with, if it has one. */
function callbackLocale(link: string, appUrl: string): SignupRouteLocale | undefined {
  const callback = parse(link)?.searchParams.get('callbackURL');
  return callback ? appCallbackParts(callback, appUrl)?.locale : undefined;
}

/** A callback on the web app, split into the app's base, its locale segment and the rest. */
function appCallbackParts(callback: string, appUrl: string): undefined | { base: string; locale: SignupRouteLocale; rest: string } {
  const app = parse(appUrl);
  const target = parse(callback);
  if (!app || target?.origin !== app.origin) return undefined;
  const basePath = app.pathname.replace(/\/$/u, '');
  if (!target.pathname.startsWith(`${basePath}/`)) return undefined;
  const [segment = '', ...after] = target.pathname.slice(basePath.length + 1).split('/');
  if (!(SIGNUP_ROUTE_LOCALES as readonly string[]).includes(segment)) return undefined;
  const rest = `${after.length ? `/${after.join('/')}` : ''}${target.search}${target.hash}`;
  return { base: `${app.origin}${basePath}`, locale: segment as SignupRouteLocale, rest };
}

function parse(value: string): undefined | URL {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
