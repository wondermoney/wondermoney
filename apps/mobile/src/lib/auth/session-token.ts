/**
 * Bearer-snapshot extraction for `/v1/*` calls.
 *
 * The better-auth HTTP client authenticates `/api/auth/*` with a session
 * *cookie*. The product API on `/v1/*` authenticates with an opaque
 * `Authorization: Bearer <token>` credential instead, and better-auth's bearer
 * plugin accepts the signed session-cookie value verbatim (it re-signs a bare
 * token and verifies a signed one). This module isolates the one piece worth
 * unit-testing — turning the cookie header the Expo client holds into that
 * opaque value — so it can be exercised without constructing the vendor client.
 *
 * Neither the cookie header nor the token is ever logged.
 */

const SESSION_COOKIE_SUFFIX = 'session_token'

/**
 * Reads the session-cookie value out of a serialized Cookie header such as
 * `better-auth.session_token=abc.def; better-auth.session_data=…`.
 *
 * Both the Secure-prefixed (`__Secure-better-auth.session_token`) and custom
 * (`prod.better-auth.session_token`) names share the `.session_token` suffix,
 * so the match is on the suffix rather than an exact name.
 */
export const extractSessionTokenFromCookieHeader = (
  header: string | null | undefined,
): string | null => {
  if (!header) return null

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue

    const name = part.slice(0, separator).trim()
    if (name !== SESSION_COOKIE_SUFFIX && !name.endsWith(`.${SESSION_COOKIE_SUFFIX}`)) continue

    const value = part.slice(separator + 1).trim()
    if (!value) return null

    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  return null
}
