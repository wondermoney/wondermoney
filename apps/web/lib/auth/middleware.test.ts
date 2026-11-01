import assert from "node:assert/strict";

import { NextRequest, NextResponse } from "next/server";
import { test } from "vitest";

import { updateSession } from "./middleware";

async function redirectFor(
  url: string,
  { loggedIn = false }: { loggedIn?: boolean } = {},
): Promise<URL | null> {
  const request = new NextRequest(url, {
    headers: loggedIn ? { cookie: "better-auth.session_token=t" } : {},
  });
  const response = await updateSession(request, NextResponse.next());
  const location = response.headers.get("location");
  return location ? new URL(location) : null;
}

test("a logged-out visit to a protected page goes to login with the page as next", async () => {
  const location = await redirectFor(
    "http://localhost:3000/en/accounts/42?tab=transactions",
  );

  assert.ok(location);
  assert.equal(location.pathname, "/en/auth/login");
  assert.deepEqual(
    [...location.searchParams.entries()],
    [["next", "/en/accounts/42?tab=transactions"]],
  );
});

test("a logged-out visit to the landing page goes to login without next", async () => {
  const location = await redirectFor("http://localhost:3000/pt");

  assert.ok(location);
  assert.equal(location.pathname, "/pt/auth/login");
  assert.equal(location.search, "");
});

test("auth pages are not redirected, so next survives on the login page", async () => {
  assert.equal(
    await redirectFor("http://localhost:3000/en/auth/login?next=%2Fen%2Fsettings"),
    null,
  );
  assert.equal(
    await redirectFor("http://localhost:3000/en/auth/mfa?next=%2Fen%2Fsettings"),
    null,
  );
});

test("a signed-in visit to login with a safe next goes straight there", async () => {
  const location = await redirectFor(
    "http://localhost:3000/en/auth/login?next=%2Fen%2Fsettings%3Ftab%3Dsecurity",
    { loggedIn: true },
  );

  assert.ok(location);
  assert.equal(location.origin, "http://localhost:3000");
  assert.equal(`${location.pathname}${location.search}`, "/en/settings?tab=security");
});

test("a signed-in visit to login with an unsafe next goes home", async () => {
  const location = await redirectFor(
    "http://localhost:3000/en/auth/login?next=%2F%2Fevil.example",
    { loggedIn: true },
  );

  assert.ok(location);
  assert.equal(location.origin, "http://localhost:3000");
  assert.equal(location.pathname, "/en");
  assert.equal(location.search, "");
});

test("a logged-out visit to an unprefixed page keeps it as a localised next", async () => {
  const location = await redirectFor("http://localhost:3000/accounts/42?tab=x");

  assert.ok(location);
  assert.equal(location.pathname, "/en/auth/login");
  assert.equal(location.searchParams.get("next"), "/en/accounts/42?tab=x");
});
