import { routing } from "@/i18n/routing";
import { stripLocalePrefix } from "@/lib/navigation/strip-locale-prefix";

/**
 * The `?next=` destination a user returns to after logging in.
 *
 * `next` arrives from a query string, so it is attacker-controlled: a crafted
 * login link must never send a freshly authenticated user to another origin.
 * Every reader of `next` goes through `getSafeNextPath`; anything it rejects
 * falls back to the default landing page.
 */

const MAX_NEXT_LENGTH = 2048;
const MAX_DECODE_PASSES = 4;
// Backslashes are treated as slashes by browsers (`/\evil` is `//evil`), and
// tabs/newlines are stripped before parsing (`/\t/evil` is `//evil`).
const UNSAFE_CHARACTERS = /[\\\u0000-\u001f\u007f]/;
// Resolves dot segments in a decoded form without trusting it as a URL.
const PARSE_BASE = "http://placeholder.invalid";
const LOCALES: readonly string[] = routing.locales;

function isRootedSinglySlashed(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !UNSAFE_CHARACTERS.test(value)
  );
}

/** `/en`, `/pt/accounts`: the first segment is exactly one of the app's locales. */
function isLocaleRoute(pathname: string): boolean {
  return LOCALES.includes(pathname.split("/")[1] ?? "");
}

/**
 * Whether a form of `next` stays rooted at one slash and inside the locale
 * routes once its dot segments resolve (`/en/../api` is `/api`).
 */
function isSafeForm(value: string): boolean {
  if (!isRootedSinglySlashed(value)) return false;
  let pathname: string;
  try {
    pathname = new URL(value, PARSE_BASE).pathname;
  } catch {
    // no-excuse-ok: catch -- an unparsable value is simply unsafe
    return false;
  }
  return isRootedSinglySlashed(pathname) && isLocaleRoute(pathname);
}

/**
 * Rejects the value if any percent-decoded form of it is unsafe
 * (`/%2F%2Fevil`, `/en/..%2F..%2Fapi`).
 */
function isSafeAtEveryDecoding(value: string): boolean {
  let current = value;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    if (!isSafeForm(current)) return false;

    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      // no-excuse-ok: catch -- malformed percent-encoding is simply unsafe
      return false;
    }
    if (decoded === current) return true;
    current = decoded;
  }
  // Still decoding after several passes: nothing legitimate is nested this deep.
  return false;
}

function isAuthPath(pathname: string): boolean {
  const path = stripLocalePrefix(pathname);
  return path === "/auth" || path.startsWith("/auth/");
}

/**
 * Returns `next` as a same-origin path (`pathname + search + hash`) when it is
 * safe to redirect to, or `null` when the caller should use its default
 * landing page.
 *
 * Safe means: a string that starts with exactly one `/`, contains no
 * backslashes or control characters in any percent-decoded form, stays under
 * one of the app's locale routes (`/en/...`, `/pt/...`, `/es/...`) in every
 * form, still resolves to `origin` once parsed with `new URL(next, origin)`,
 * and is not an auth page (which would loop back into login/MFA).
 */
export function getSafeNextPath(next: unknown, origin: string): string | null {
  if (typeof next !== "string" || next.length === 0) return null;
  if (next.length > MAX_NEXT_LENGTH) return null;
  if (!isSafeAtEveryDecoding(next)) return null;

  let base: URL;
  let resolved: URL;
  try {
    base = new URL(origin);
    resolved = new URL(next, base);
  } catch {
    // no-excuse-ok: catch -- an unparsable value is simply unsafe
    return null;
  }

  if (resolved.origin !== base.origin) return null;

  // Dot segments can normalise into a protocol-relative path
  // (`/..//evil` -> `//evil`), so check the result as well as the input.
  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  if (!isRootedSinglySlashed(path)) return null;
  if (!isLocaleRoute(resolved.pathname)) return null;
  if (isAuthPath(resolved.pathname)) return null;

  return path;
}

/**
 * Appends `next` to an auth URL (absolute or root-relative) as a real query
 * parameter. Pass only a value that came out of `getSafeNextPath`.
 */
export function withNextParam(url: string, next: string | null): string {
  if (!next) return url;

  const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(url);
  const parsed = new URL(url, "http://placeholder.invalid");
  parsed.searchParams.set("next", next);

  return isAbsolute
    ? parsed.toString()
    : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
