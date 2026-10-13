/**
 * Shared better-auth session helpers for the Cypress specs.
 *
 * better-auth runs inside the `api` service and its native endpoints live at
 * `<api>/api/auth/*`. The specs used to authenticate against Supabase (admin
 * API for the portfolio lane, `/auth/v1/token` for the others) and store a
 * Supabase session in the browser. Both are gone: a better-auth email/password
 * user is created/signed in through `/api/auth/sign-up/email` and
 * `/api/auth/sign-in/email`, and the opaque session token is read back as a
 * bearer credential.
 *
 * Bearer extraction: better-auth's `bearer` plugin exposes the session token on
 * the `set-auth-token` response header (and, for sign-up/sign-in, as
 * `body.token`). `POST /v1/auth/callback` then accepts it as
 * `Authorization: Bearer <token>`, validated by better-auth's `getSession`.
 *
 * The sign-up/sign-in responses also set better-auth's session cookie, which
 * Cypress stores in the browser cookie jar. Specs that want to exercise the web
 * sign-in form must `cy.clearCookies()` first, otherwise the optimistic
 * middleware redirects the already-authenticated browser away from `/auth/login`.
 */

export type BetterAuthApiSession = {
  readonly accessToken: string;
  readonly userId: string;
};

type BetterAuthResponseBody = {
  readonly token?: unknown;
  readonly user?: { readonly id?: unknown };
};

/** API origin; overridable with `E2E_API_BASE_URL` (defaults to local dev). */
export function apiBaseUrl(): string {
  const configured = Cypress.env("E2E_API_BASE_URL");
  return typeof configured === "string" && configured.length > 0
    ? configured
    : "http://localhost:3001";
}

function betterAuthApiUrl(): string {
  return `${apiBaseUrl()}/api/auth`;
}

function readToken(
  response: Cypress.Response<BetterAuthResponseBody>,
): string | null {
  const headerToken = response.headers["set-auth-token"];
  if (typeof headerToken === "string" && headerToken.length > 0) {
    return headerToken;
  }
  const bodyToken = response.body?.token;
  return typeof bodyToken === "string" && bodyToken.length > 0
    ? bodyToken
    : null;
}

function readUserId(
  response: Cypress.Response<BetterAuthResponseBody>,
): string | null {
  const id = response.body?.user?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Creates the better-auth email/password user when it does not exist yet, then
 * signs in, and returns the bearer session token plus the better-auth user id
 * (the `externalUserId` the API stores on the linked appuser).
 *
 * Sign-up is attempted first so a fresh `<local>+<timestamp>@…` address works
 * without any admin/service credential. When the address already exists the
 * sign-up is a no-op error and the subsequent sign-in is used instead.
 */
export function createOrSignInBetterAuthUser(
  email: string,
  password: string,
  name = "E2E Test User",
): Cypress.Chainable<BetterAuthApiSession> {
  // A stale session cookie would make better-auth's CSRF middleware demand an
  // Origin/Referer header that node-side `cy.request` does not send.
  cy.clearCookies();

  return cy
    .request<BetterAuthResponseBody>({
      body: { email, name, password },
      failOnStatusCode: false,
      log: false,
      method: "POST",
      url: `${betterAuthApiUrl()}/sign-up/email`,
    })
    .then((signUpResponse) => {
      const token = readToken(signUpResponse);
      const userId = readUserId(signUpResponse);
      if (token && userId) {
        return cy.wrap<BetterAuthApiSession>({ accessToken: token, userId });
      }

      return cy
        .request<BetterAuthResponseBody>({
          body: { email, password },
          failOnStatusCode: false,
          log: false,
          method: "POST",
          url: `${betterAuthApiUrl()}/sign-in/email`,
        })
        .then((signInResponse) => {
          const signInToken = readToken(signInResponse);
          const signInUserId = readUserId(signInResponse);
          if (!signInToken || !signInUserId) {
            throw new Error(
              `better-auth could not create or sign in the E2E user ${email} (HTTP ${signInResponse.status})`,
            );
          }
          return cy.wrap<BetterAuthApiSession>({
            accessToken: signInToken,
            userId: signInUserId,
          });
        });
    });
}
