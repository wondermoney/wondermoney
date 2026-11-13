/** The invite page for `token`, as a locale-prefixed path `getSafeNextPath` accepts. */
export function joinPath(locale: string, token: string): string {
  return `/${locale}/join?token=${encodeURIComponent(token)}`;
}

/**
 * The login page that returns to the invite once signed in. Signing in never
 * joins a household by itself: back on /join the user confirms, and only that
 * click accepts the invite.
 */
export function signInToAcceptHref(locale: string, token: string) {
  return { pathname: "/auth/login", query: { next: joinPath(locale, token) } };
}
