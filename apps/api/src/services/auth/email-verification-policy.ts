/**
 * Whether the AI features need a verified email (`AI_REQUIRES_VERIFIED_EMAIL`).
 *
 * Off by default: a self-hosted install, often one person on the log email driver, keeps AI open
 * to every account. The hosted instance turns it on, because it pays for every model call and
 * sign-up is open, so a throwaway address must not reach the assistant, receipt OCR or CSV
 * mapping. Google and Apple accounts arrive verified; an email/password account verifies through
 * the link sent at sign-up (`sendOnSignUp` follows this flag).
 */
type Env = Readonly<Record<string, string | undefined>>;

export function aiRequiresVerifiedEmail(env: Env = process.env): boolean {
  const value = env['AI_REQUIRES_VERIFIED_EMAIL']?.trim().toLowerCase();
  return value !== undefined && ['1', 'on', 'true', 'yes'].includes(value);
}

/**
 * better-auth's verification link redirects to its `callbackURL` once followed, and falls back to
 * `/` (the API's own root) when the client sent none. A resend sends none, from the web or the
 * mobile app, nor does a mobile sign-up without a language (one with gets its callback from
 * `sign-up-locale.ts`), so point those links at the web app instead: at its page in `locale` when
 * the account's locale is known. A callback the client did choose is kept.
 */
export function verificationLinkLandingOnApp(link: string, appUrl: string, locale?: string): string {
  const url = new URL(link);
  const callback = url.searchParams.get('callbackURL');
  if (callback && callback !== '/') return link;
  url.searchParams.set('callbackURL', locale ? `${appUrl.replace(/\/$/u, '')}/${locale}` : appUrl);
  return url.toString();
}
