import assert from "node:assert/strict";

import { NextRequest } from "next/server";
import { afterEach, test, vi } from "vitest";

import type { RecaptchaVerifyResponse } from "./route";

/**
 * The signup form trusts this route's `success`. It must fail closed: the E2E
 * bypass flag is honoured only outside production, and a missing secret is a
 * refusal, never a pass.
 */
async function verify(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  const { POST } = await import("./route");
  const response = await POST(
    new NextRequest("http://localhost:3000/api/recaptcha", {
      body: JSON.stringify({ token: "client-token" }),
      method: "POST",
    }),
  );
  const body = (await response.json()) as RecaptchaVerifyResponse;
  return { body, status: response.status };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("the E2E bypass passes signup outside production", async () => {
  const { body } = await verify({
    E2E_BYPASS_RECAPTCHA: "1",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    RECAPTCHA_SECRET_KEY: undefined,
    VERCEL_ENV: "preview",
  });

  assert.equal(body.success, true);
  assert.equal(body.action, "non_production_bypass");
});

test("the E2E bypass flag is ignored on a production deployment", async () => {
  const { body, status } = await verify({
    E2E_BYPASS_RECAPTCHA: "1",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    RECAPTCHA_SECRET_KEY: undefined,
    VERCEL_ENV: "production",
  });

  assert.equal(body.success, false);
  assert.equal(status, 503);
});

test("the E2E bypass flag is ignored on the production app origin", async () => {
  const { body } = await verify({
    E2E_BYPASS_RECAPTCHA: "1",
    NEXT_PUBLIC_APP_URL: "https://app.wonder.money",
    RECAPTCHA_SECRET_KEY: undefined,
    VERCEL_ENV: undefined,
  });

  assert.equal(body.success, false);
});

test("a missing secret refuses verification instead of passing it", async () => {
  const { body, status } = await verify({
    E2E_BYPASS_RECAPTCHA: undefined,
    RECAPTCHA_SECRET_KEY: undefined,
    VERCEL_ENV: undefined,
  });

  assert.equal(body.success, false);
  assert.equal(status, 503);
});

test("a low score from Google is a refusal", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ action: "signup", score: 0.1, success: true }),
    ),
  );

  const { body } = await verify({
    E2E_BYPASS_RECAPTCHA: undefined,
    RECAPTCHA_SECRET_KEY: "secret",
    VERCEL_ENV: undefined,
  });

  assert.equal(body.success, false);
});
