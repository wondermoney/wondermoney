/**
 * How old a better-auth session may be for a sensitive action: creating a personal API token or
 * a calendar feed, pairing a phone, or consenting to an OAuth client.
 *
 * better-auth's own `freshSessionMiddleware` treats a session as fresh for `session.freshAge`
 * (24 hours by default); we reuse that notion rather than inventing a second one. A long-lived
 * credential should not be mintable from a session someone left open on a shared machine weeks ago.
 * Apart from `middleware/sensitive-session.ts` so better-auth's own hooks can read it too.
 */
export const SENSITIVE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
