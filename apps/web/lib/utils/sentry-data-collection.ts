import type * as Sentry from "@sentry/nextjs";

type DataCollection = NonNullable<Parameters<typeof Sentry.init>[0]["dataCollection"]>;

/**
 * What a Sentry event from the web app may carry (issue #38). Every web init —
 * browser (`sentry-client.ts`), server and edge — passes this object, because
 * Sentry 11 collects everything by default when `dataCollection` is left unset:
 * request/response bodies, cookies, all headers, query strings, user info,
 * database query data, queue arguments and gen-AI inputs/outputs.
 *
 * Header and query-parameter allow-lists are matched by Sentry as
 * case-insensitive *substrings*, so every term must be specific enough not to
 * admit a sensitive key. Sentry additionally filters keys containing `auth`,
 * `token`, `session`, `key`, `cookie` and the like, even when allow-listed.
 *
 * https://docs.sentry.io/platforms/javascript/data-management/data-collected/
 * https://docs.sentry.io/platforms/javascript/migration/v10-to-v11/
 */
export const SENTRY_DATA_COLLECTION: DataCollection = {
  // No email, username or IP. A user id is the most that may be attached, and
  // only by an explicit `Sentry.setUser({ id })`.
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { allow: ["user-agent", "content-type", "content-length"] },
    response: { allow: ["content-type", "content-length"] },
  },
  httpBodies: [],
  urlQueryParams: { allow: ["page", "limit", "offset", "sort", "order", "direction"] },
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  // Local variable values can hold balances and form input.
  stackFrameVariables: false,
};
