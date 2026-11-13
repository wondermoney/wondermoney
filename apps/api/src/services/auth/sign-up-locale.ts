import type { BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';

import { SIGNUP_ROUTE_LOCALES, type SignupRouteLocale } from '@validators/auth';

/**
 * The web locale the first language of an `Accept-Language` header names (`pt-PT` → `pt`,
 * `es-419` → `es`), or nothing for a language the web app doesn't have.
 */
export function acceptLanguageLocale(header: null | string | undefined): SignupRouteLocale | undefined {
  const base = header?.split(',')[0]?.split(';')[0]?.trim().split(/[-_]/u)[0]?.toLowerCase();
  return SIGNUP_ROUTE_LOCALES.find((locale) => locale === base);
}

/**
 * An email/password sign-up that names no `callbackURL` gets the app's page in the language its
 * `Accept-Language` asks for, `<appUrl>/<locale>`: the callback the web sign-up form sends.
 *
 * The verification email better-auth sends at sign-up goes out before the account exists, so its
 * language and the page its link lands on come from that callback's locale. The mobile app has no
 * web page to name, so it sends its app language as `Accept-Language`, and its first email and
 * landing page match a web sign-up's. The callback is built here from the app's own URL, never
 * from the request, and a callback the client did send is kept as it is (better-auth checks it
 * against the trusted origins). Without a supported language, nothing changes.
 */
export const signUpLocale = ({ appUrl }: { appUrl: string }): BetterAuthPlugin => {
  const base = appUrl.replace(/\/$/u, '');
  return {
    hooks: {
      before: [
        {
          handler: createAuthMiddleware((ctx) => {
            const body = ctx.body as undefined | { callbackURL?: unknown };
            const locale = body && !body.callbackURL ? acceptLanguageLocale(ctx.headers?.get('accept-language')) : undefined;
            return Promise.resolve(locale ? { context: { body: { ...body, callbackURL: `${base}/${locale}` } } } : undefined);
          }),
          matcher: (context) => context.path === '/sign-up/email',
        },
      ],
    },
    id: 'sign-up-locale',
  };
};
