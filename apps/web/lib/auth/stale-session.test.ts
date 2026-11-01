import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * A browser holding a session cookie the API no longer accepts (session
 * revoked, database reset, secret rotated) must land on the login page, with
 * the cookie gone, instead of bouncing between the optimistic middleware
 * redirect and the authoritative server check until ERR_TOO_MANY_REDIRECTS.
 *
 * These tests drive the real proxy (next-intl + session middleware) and the
 * real `requireServerAuth` gate together, the way a browser would: follow each
 * redirect, apply every Set-Cookie to a cookie jar, and stop when a page
 * renders.
 */

const state = vi.hoisted(() => ({
  // The shared cookie domain is deploy config (NEXT_PUBLIC_AUTH_COOKIE_DOMAIN, or
  // "localhost" for a local app URL). Pin it so the result can't depend on the env
  // the tests happen to run in.
  cookieDomain: ".example.test" as string | undefined,
  cookieHeader: "",
  requestHeaders: new Headers(),
}));

class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super(`NEXT_REDIRECT:${location}`);
  }
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/url")>()),
  getCookiesDomain: () => state.cookieDomain,
}));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    // Mirrors next/navigation: redirect() throws to abort the render.
    throw new RedirectSignal(location);
  },
}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ toString: () => state.cookieHeader }),
  headers: () => Promise.resolve(state.requestHeaders),
}));

const { proxy } = await import("@/proxy");
const { requireServerAuth } = await import("./server-auth");

const ORIGIN = "http://localhost:3000";
const SESSION_COOKIE = "better-auth.session_token";

type Jar = Map<string, string>;

function serialize(jar: Jar): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** Applies a response's Set-Cookie headers the way a browser would. */
function applySetCookies(response: NextResponse, jar: Jar) {
  for (const header of response.headers.getSetCookie()) {
    const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    const expired = attributes.some((attribute) => {
      const [key = "", attributeValue = ""] = attribute.split("=");
      if (key.toLowerCase() === "max-age") return Number(attributeValue) <= 0;
      if (key.toLowerCase() === "expires") {
        return new Date(attributeValue).getTime() <= Date.now();
      }
      return false;
    });
    if (expired) jar.delete(name);
    else jar.set(name, value);
  }
}

/** The request headers the middleware forwards to the page it lets through. */
function forwardedRequestHeaders(response: NextResponse): Headers {
  const forwarded = new Headers();
  const names = response.headers.get("x-middleware-override-headers") ?? "";
  for (const name of names.split(",").filter(Boolean)) {
    const value = response.headers.get(`x-middleware-request-${name}`);
    if (value !== null) forwarded.set(name, value);
  }
  return forwarded;
}

function isAuthPage(pathname: string) {
  return /^\/[a-z]{2}\/auth(\/|$)/.test(pathname);
}

/**
 * Visits `start` and follows redirects until a page renders. Protected pages
 * run the (full-layout) gate: `requireServerAuth(locale)`.
 */
async function browse(start: string, jar: Jar) {
  const redirects: URL[] = [];
  let url = new URL(start, ORIGIN);

  for (let hop = 0; hop < 10; hop += 1) {
    const response = await proxy(
      new NextRequest(url, { headers: { cookie: serialize(jar) } }),
    );
    applySetCookies(response, jar);

    const location = response.headers.get("location");
    if (location) {
      url = new URL(location, url);
      redirects.push(url);
      continue;
    }

    if (isAuthPage(url.pathname)) return { landed: url, redirects };

    state.cookieHeader = serialize(jar);
    state.requestHeaders = forwardedRequestHeaders(response);
    try {
      await requireServerAuth(url.pathname.split("/")[1] ?? "en");
      return { landed: url, redirects };
    } catch (error) {
      if (!(error instanceof RedirectSignal)) throw error;
      url = new URL(error.location, url);
      redirects.push(url);
    }
  }

  throw new Error(
    `redirect loop: ${redirects.map((r) => `${r.pathname}${r.search}`).join(" -> ")}`,
  );
}

function stubGetSession(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
    ),
  );
}

describe("a session cookie the API no longer accepts", () => {
  beforeEach(() => {
    // better-auth answers 200 `null` for an unknown or revoked session token.
    stubGetSession(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.each(["/en", "/en/auth/login", "/en/auth/signup"])(
    "%s reaches the login page in at most two redirects and drops the cookie",
    async (start) => {
      const jar: Jar = new Map([[SESSION_COOKIE, "revoked.token"]]);

      const { landed, redirects } = await browse(start, jar);

      expect(landed.pathname).toBe("/en/auth/login");
      expect(redirects.length).toBeLessThanOrEqual(2);
      expect(jar.has(SESSION_COOKIE)).toBe(false);
    },
  );

  test("a protected page comes back after login through a safe next", async () => {
    const jar: Jar = new Map([[SESSION_COOKIE, "revoked.token"]]);

    const { landed } = await browse("/en/accounts/42?tab=transactions", jar);

    expect(landed.pathname).toBe("/en/auth/login");
    expect(landed.searchParams.get("next")).toBe("/en/accounts/42?tab=transactions");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  test("a spoofed request-path header cannot plant an off-site next", async () => {
    const jar: Jar = new Map([[SESSION_COOKIE, "revoked.token"]]);

    state.cookieHeader = serialize(jar);
    state.requestHeaders = new Headers({ "x-wm-request-path": "//evil.example" });
    const error = await requireServerAuth("en").then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(RedirectSignal);
    const location = new URL((error as RedirectSignal).location, ORIGIN);
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe("/en/auth/login");
    expect(location.searchParams.get("next")).toBeNull();
  });

  test("signing in again afterwards works without clearing cookies by hand", async () => {
    const jar: Jar = new Map([[SESSION_COOKIE, "revoked.token"]]);
    await browse("/en/settings", jar);

    // The login form's sign-in sets a fresh, valid session cookie.
    jar.set(SESSION_COOKIE, "fresh.token");
    stubGetSession({ session: { id: "s" }, user: { id: "u" } });

    const { landed, redirects } = await browse("/en/settings", jar);

    expect(landed.pathname).toBe("/en/settings");
    expect(redirects).toEqual([]);
    expect(jar.get(SESSION_COOKIE)).toBe("fresh.token");
  });
});

describe("a valid session cookie", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("renders the protected page and keeps the cookie", async () => {
    stubGetSession({ session: { id: "s" }, user: { id: "u" } });
    const jar: Jar = new Map([[SESSION_COOKIE, "valid.token"]]);

    const { landed, redirects } = await browse("/en/budgets", jar);

    expect(landed.pathname).toBe("/en/budgets");
    expect(redirects).toEqual([]);
    expect(jar.get(SESSION_COOKIE)).toBe("valid.token");
  });

  test("visiting login still goes back into the app", async () => {
    stubGetSession({ session: { id: "s" }, user: { id: "u" } });
    const jar: Jar = new Map([[SESSION_COOKIE, "valid.token"]]);

    const { landed } = await browse("/en/auth/login", jar);

    expect(landed.pathname).toBe("/en");
    expect(jar.get(SESSION_COOKIE)).toBe("valid.token");
  });
});

describe("clearing a rejected session cookie", () => {
  async function setCookiesFor(url: string, cookie: string) {
    const response = await proxy(new NextRequest(url, { headers: { cookie } }));
    return response.headers.getSetCookie();
  }

  test("expires only better-auth cookies, with the attributes they were set with", async () => {
    const setCookies = await setCookiesFor(
      "https://app.example.test/en/auth/login?reason=session-expired",
      "__Secure-better-auth.session_token=t; better-auth.session_data.0=d; NEXT_LOCALE=en",
    );

    const expired = setCookies.filter((header) => header.includes("Max-Age=0"));
    const names = new Set(expired.map((header) => header.split("=")[0]));
    expect(names).toEqual(
      new Set(["__Secure-better-auth.session_token", "better-auth.session_data.0"]),
    );
    for (const header of expired) {
      expect(header).toContain("Path=/");
      expect(header).toContain("Secure");
    }
    // Host-only and shared-domain copies are both expired.
    expect(
      expired.filter((h) => h.startsWith("__Secure-better-auth.session_token=")),
    ).toHaveLength(2);
    expect(setCookies.some((header) => header.startsWith("NEXT_LOCALE=;"))).toBe(false);
  });

  test("with no shared cookie domain, expires the host-only cookie once", async () => {
    state.cookieDomain = undefined;
    try {
      const setCookies = await setCookiesFor(
        "https://app.example.test/en/auth/login?reason=session-expired",
        "__Secure-better-auth.session_token=t",
      );
      const expired = setCookies.filter((h) => h.startsWith("__Secure-better-auth.session_token="));
      expect(expired).toHaveLength(1);
      expect(expired[0]).not.toContain("Domain=");
    } finally {
      state.cookieDomain = ".example.test";
    }
  });

  test("the marker on its own changes nothing for a signed-out visitor", async () => {
    const response = await proxy(
      new NextRequest(`${ORIGIN}/en/auth/login?reason=session-expired`),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(
      response.headers.getSetCookie().filter((header) => header.includes("better-auth")),
    ).toEqual([]);
  });
});
