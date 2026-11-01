import assert from "node:assert/strict";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, test, vi } from "vitest";

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@/lib/api/api", () => ({
  default: { post: apiPost },
  getApiUrl: () => "http://api.test",
}));

const { GET } = await import("./route");

const APP_ORIGIN = "http://localhost:3000";

function stubSession(hasFullSession: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      hasFullSession
        ? Response.json({ session: { id: "s" }, user: { id: "u" } })
        : Response.json(null),
    ),
  );
}

async function completeWith(query: string): Promise<URL> {
  const response = await GET(
    new NextRequest(`${APP_ORIGIN}/en/auth/complete${query}`),
  );
  const location = response.headers.get("location");
  assert.ok(location, "expected a redirect");
  return new URL(location);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_ORIGIN);
  apiPost.mockResolvedValue({ data: { outcome: "login", method: "google" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  apiPost.mockReset();
});

test("Google sign-in returns to a safe next", async () => {
  stubSession(true);

  const location = await completeWith("?next=%2Fen%2Faccounts%2F42%3Ftab%3Dx");

  assert.equal(location.origin, APP_ORIGIN);
  assert.equal(`${location.pathname}${location.search}`, "/en/accounts/42?tab=x");
});

test("Google sign-in without next lands on the locale home", async () => {
  stubSession(true);

  const location = await completeWith("");

  assert.equal(location.origin, APP_ORIGIN);
  assert.equal(location.pathname, "/en");
});

for (const unsafe of ["//evil.example", "https://evil.example/", "/%2F%2Fevil.example", "/\\evil.example", "/api/auth/sign-out"]) {
  test(`Google sign-in ignores unsafe next ${JSON.stringify(unsafe)}`, async () => {
    stubSession(true);

    const location = await completeWith(`?next=${encodeURIComponent(unsafe)}`);

    assert.equal(location.origin, APP_ORIGIN);
    assert.equal(location.pathname, "/en");
  });
}

test("a pending 2FA challenge goes to MFA with next carried along", async () => {
  stubSession(false);

  const location = await completeWith("?next=%2Fen%2Fsettings");

  assert.equal(location.pathname, "/en/auth/mfa");
  assert.equal(location.searchParams.get("next"), "/en/settings");
});

test("a pending 2FA challenge drops an unsafe next", async () => {
  stubSession(false);

  const location = await completeWith(`?next=${encodeURIComponent("//evil.example")}`);

  assert.equal(location.pathname, "/en/auth/mfa");
  assert.equal(location.searchParams.has("next"), false);
});

test("signup markers smuggled in next are not replayed on a login", async () => {
  stubSession(true);

  const location = await completeWith(
    `?next=${encodeURIComponent("/en/settings?signup_completed=1&signup_method=x&tab=y")}`,
  );

  assert.equal(location.pathname, "/en/settings");
  assert.equal(location.searchParams.has("signup_completed"), false);
  assert.equal(location.searchParams.has("signup_method"), false);
  assert.equal(location.searchParams.get("tab"), "y");
});

test("a real Google signup still gets its completion markers on next", async () => {
  stubSession(true);
  apiPost.mockResolvedValue({ data: { outcome: "signup", method: "google" } });

  const location = await completeWith("?next=%2Fen%2Fsettings");

  assert.equal(location.pathname, "/en/settings");
  assert.equal(location.searchParams.get("signup_completed"), "1");
  assert.equal(location.searchParams.get("signup_source"), "auth_complete");
});
