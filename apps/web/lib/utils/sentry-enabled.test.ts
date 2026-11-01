import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

// The flags are compile-time constants, so each case loads a fresh module.
async function load(environment: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("NEXT_PUBLIC_ENABLE_SENTRY", "");
  vi.stubEnv("ENABLE_SENTRY", "");
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  return import("./sentry-enabled");
}

afterEach(() => vi.unstubAllEnvs());

test("a local build reports nothing to Sentry unless asked to", async () => {
  const flags = await load({});

  assert.equal(flags.SENTRY_CLIENT_ENABLED, false);
  assert.equal(flags.SENTRY_SERVER_ENABLED, false);
});

test("production reports from both browser and server", async () => {
  const productions: Record<string, string>[] = [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }];
  for (const environment of productions) {
    const flags = await load(environment);
    assert.equal(flags.SENTRY_CLIENT_ENABLED, true);
    assert.equal(flags.SENTRY_SERVER_ENABLED, true);
  }
});

test("the client opt-in enables both sides; the server opt-in enables only the server", async () => {
  const clientOptIn = await load({ NEXT_PUBLIC_ENABLE_SENTRY: "1" });
  assert.equal(clientOptIn.SENTRY_CLIENT_ENABLED, true);
  assert.equal(clientOptIn.SENTRY_SERVER_ENABLED, true);

  const serverOptIn = await load({ ENABLE_SENTRY: "1" });
  assert.equal(serverOptIn.SENTRY_CLIENT_ENABLED, false);
  assert.equal(serverOptIn.SENTRY_SERVER_ENABLED, true);
  assert.equal(serverOptIn.isSentryEnabled(), true, "a server render uses the server flag");
});
