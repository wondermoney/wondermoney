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
 * `/` (the API's own root) when the client sent none. Neither app sends one at sign-up, so point
 * those links at the web app instead; a callback the client did choose is kept.
 */
export function verificationLinkLandingOnApp(link: string, appUrl: string): string {
  const url = new URL(link);
  const callback = url.searchParams.get('callbackURL');
  if (callback && callback !== '/') return link;
  url.searchParams.set('callbackURL', appUrl);
  return url.toString();
}
