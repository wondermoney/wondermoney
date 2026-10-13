const PAGEVIEW_QUERY_PARAMS_TO_DROP = new Set([
  "access_token",
  "attribution",
  "code",
  "error_description",
  "refresh_token",
  "signup_completed",
  "signup_method",
  "signup_source",
  "token",
]);

/**
 * The pageview URL sent to analytics, with credentials, one-time codes and
 * signup bookkeeping params removed from the query string.
 */
export function getSanitizedPageviewUrl(
  origin: string,
  pathname: string,
  searchParams: { toString(): string },
) {
  const sanitizedSearchParams = new URLSearchParams(searchParams.toString());

  for (const param of PAGEVIEW_QUERY_PARAMS_TO_DROP) {
    sanitizedSearchParams.delete(param);
  }

  const query = sanitizedSearchParams.toString();
  return query ? `${origin}${pathname}?${query}` : `${origin}${pathname}`;
}
