/**
 * The calendar the reports API should bucket the viewer's months in.
 *
 * `GET /v1/reports/*` accepts an optional `timezone` filter (IANA name) and
 * groups months in it. When the filter is absent the API assumes
 * `Europe/Lisbon`, which is right for a Lisbon reader and an hour out for a
 * Madrid one: picking August there sends `2026-07-31T22:00:00.000Z`, which is
 * still July in Lisbon, so the response carries an out-of-period July row
 * holding an hour's worth of money. The chart hides that; the CSV export does not.
 *
 * So the client states its calendar instead of letting the API guess.
 *
 * ## Server rendering
 *
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` answers with the *host's*
 * zone. On a Next.js server render that is the container's zone (usually UTC),
 * not the reader's — sending it would replace one wrong guess with another, and
 * a value that changes between the server render and hydration is exactly the
 * kind of thing that leaks into markup as a mismatch. {@link resolveViewerTimeZone}
 * therefore refuses to answer at all outside the browser: on the server the
 * filter is omitted and the API applies its own documented default, and the
 * first render that can actually fetch is also the first render that knows the
 * viewer's zone.
 *
 * ## Unusable values
 *
 * The API validates `timezone` with `Intl` and rejects anything it cannot
 * resolve, so a bad guess here is a 400 — the whole report fails rather than
 * being an hour out. Every uncertain path (no `Intl`, a throwing `Intl`, an
 * empty string, a `+01:00` offset instead of a name) resolves to `undefined`,
 * which means "say nothing and take the API's default".
 */

/**
 * IANA zone identifiers: `UTC`, `Europe/Lisbon`,
 * `America/Argentina/Buenos_Aires`, `Etc/GMT+1`.
 *
 * Deliberately excludes the offset form (`+01:00`) that ECMA-402 also permits
 * from `resolvedOptions()` on some runtimes. An offset is not a calendar — it
 * cannot express a DST transition inside the reporting period — and the API's
 * Lisbon default is a better answer than a fixed offset or a 400.
 */
const IANA_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/** True when `value` is an IANA name this runtime's `Intl` can resolve. */
export function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Narrows an ambient time-zone reading to something the reports API will accept.
 *
 * @param value - Whatever the runtime offered; no assumption is made about it
 * @returns The IANA name to send, or `undefined` to send no `timezone` at all
 */
export function toReportTimeZone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!IANA_ZONE_NAME.test(trimmed)) return undefined;
  return isSupportedTimeZone(trimmed) ? trimmed : undefined;
}

/**
 * The calendar the person reading the report lives in.
 *
 * @returns An IANA name in the browser, or `undefined` on the server and on any
 *   runtime whose `Intl` cannot name a zone — in both cases the caller must omit
 *   the `timezone` filter rather than substitute a guess.
 */
export function resolveViewerTimeZone(): string | undefined {
  // Not `typeof document`: this must be false in every non-browser render,
  // including the Node and Edge runtimes Next.js server-renders in.
  if (typeof window === "undefined") return undefined;

  try {
    return toReportTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return undefined;
  }
}
