import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const sentryHelperPath = "lib/utils/sentry-enabled.ts";
const providers = [
  read("app/providers.tsx"),
  read("lib/query/query-client.ts"),
].join("\n");
const globalError = read("app/global-error.tsx");
const instrumentation = read("instrumentation.ts");
const instrumentationClient = read("instrumentation-client.ts");
const nextConfig = read("next.config.ts");
const sentryServerConfig = read("sentry.server.config.ts");
const sentryEdgeConfig = read("sentry.edge.config.ts");
const signupForm = read("components/auth/SignupForm.tsx");
const sentryClientHelperPath = "lib/utils/sentry-client.ts";

// This check used to assert package.json exposed a `test:<domain>` script for
// itself. `pnpm test` replaced those 50 scripts with one Vitest run, and
// scripts/regression-checks.test.ts now enumerates this file from disk, so
// being wired in is structural rather than something to string-match.

assert.equal(
  existsSync(sentryHelperPath),
  true,
  "Sentry enablement should be centralized in lib/utils/sentry-enabled.ts",
);

const sentryHelper = read(sentryHelperPath);

assert.match(
  sentryHelper,
  /NEXT_PUBLIC_ENABLE_SENTRY/,
  "Sentry helper should support explicit client/local opt-in",
);

assert.match(
  sentryHelper,
  /SENTRY_CLIENT_ENABLED/,
  "Sentry helper should expose a client compile-time constant for dead-code elimination",
);

assert.match(
  sentryHelper,
  /ENABLE_SENTRY/,
  "Sentry helper should support explicit server/config opt-in",
);

assert.match(
  sentryHelper,
  /process\.env\.NODE_ENV\s*===\s*["']production["']/,
  "Sentry helper should preserve production enablement",
);

assert.match(
  sentryHelper,
  /process\.env\.VERCEL_ENV\s*===\s*["']production["']/,
  "Sentry helper should preserve the previous VERCEL_ENV production enablement path",
);

for (const [path, source] of [
  ["app/providers.tsx", providers],
  ["app/global-error.tsx", globalError],
  ["instrumentation.ts", instrumentation],
  ["instrumentation-client.ts", instrumentationClient],
] as const) {
  assert.doesNotMatch(
    source,
    /import\s+\*\s+as\s+Sentry\s+from\s+["']@sentry\/nextjs["']/,
    `${path} should not statically import @sentry/nextjs`,
  );

  assert.match(
    source,
    /isSentryEnabled|SENTRY_CLIENT_ENABLED/,
    `${path} should guard Sentry behavior behind Sentry enablement`,
  );
}

for (const [path, source] of [
  ["app/providers.tsx", providers],
  ["app/global-error.tsx", globalError],
  ["instrumentation-client.ts", instrumentationClient],
  ["components/auth/SignupForm.tsx", signupForm],
] as const) {
  assert.doesNotMatch(
    source,
    /@sentry\/nextjs/,
    `${path} should not directly reference @sentry/nextjs because Turbopack preloads those chunks`,
  );
}

assert.equal(
  existsSync(sentryClientHelperPath),
  true,
  "browser Sentry imports should be isolated in lib/utils/sentry-client.ts",
);

const sentryClientHelper = read(sentryClientHelperPath);

assert.match(
  sentryClientHelper,
  /@sentry\/nextjs/,
  "Sentry client helper should own the browser Sentry SDK import",
);

assert.match(
  sentryClientHelper,
  /captureClientMessage/,
  "Sentry client helper should expose message capture for client components",
);

assert.match(
  sentryClientHelper,
  /beforeSend\s*\(/,
  "Sentry client helper should define beforeSend for client-side filtering",
);

assert.match(
  sentryClientHelper,
  /undefined is not an object \(evaluating 'window\.webkit\.messageHandlers'\)/,
  "Sentry client helper should include the exact WKWebView bridge error string",
);

assert.match(
  sentryClientHelper,
  /return isKnownWKWebViewBridgeNoise\(event\) \? null : event;/,
  "Sentry client helper should return null only for the exact WKWebView noise path",
);

assert.doesNotMatch(
  sentryClientHelper,
  /window\.webkit\s*=|messageHandlers\s*=\s*[^=]/,
  "Sentry client helper should not add a WebKit bridge shim",
);

assert.match(
  providers,
  /import\(["']@\/lib\/utils\/sentry-client["']\)/,
  "providers should dynamically import the Sentry client helper only when needed",
);

assert.match(
  globalError,
  /import\(["']@\/lib\/utils\/sentry-client["']\)/,
  "global error boundary should dynamically import the Sentry client helper only when enabled",
);

assert.match(
  globalError,
  /SENTRY_CLIENT_ENABLED/,
  "global error boundary should guard Sentry behavior behind the client enablement constant",
);

assert.match(
  signupForm,
  /SENTRY_CLIENT_ENABLED/,
  "signup form should guard Sentry message capture behind the client enablement constant",
);

assert.match(
  signupForm,
  /import\(["']@\/lib\/utils\/sentry-client["']\)/,
  "signup form should dynamically import the Sentry client helper only when enabled",
);

assert.match(
  signupForm,
  /catch\(\(\) => {}\)/,
  "signup form Sentry capture should be best-effort and must not block user feedback",
);

assert.match(
  instrumentation,
  /import\(["']@sentry\/nextjs["']\)/,
  "server instrumentation should dynamically import Sentry only when enabled",
);

assert.match(
  instrumentationClient,
  /import\(["']@\/lib\/utils\/sentry-client["']\)/,
  "client instrumentation should dynamically import the Sentry client helper only when enabled",
);

for (const [path, source] of [
  ["sentry.server.config.ts", sentryServerConfig],
  ["sentry.edge.config.ts", sentryEdgeConfig],
] as const) {
  assert.match(
    source,
    /SENTRY_SERVER_ENABLED|isSentryEnabled/,
    `${path} should use centralized Sentry enablement so local server opt-in works`,
  );

  assert.doesNotMatch(
    source,
    /enabled:\s*\n?\s*process\.env\.NODE_ENV\s*===\s*["']production["']\s*\|\|\s*\n?\s*process\.env\.VERCEL_ENV\s*===\s*["']production["']/,
    `${path} should not keep a second hard-coded production-only enabled gate`,
  );
}

assert.match(
  nextConfig,
  /isSentryConfigEnabled/,
  "next.config.ts should gate withSentryConfig behind a config-time helper",
);

assert.match(
  nextConfig,
  /isSentryConfigEnabled\(\)\s*\?\s*withSentryConfig/,
  "next.config.ts should only apply withSentryConfig when Sentry is enabled",
);

console.log("Sentry DX regression checks passed");
