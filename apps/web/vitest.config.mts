import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  oxc: {
    // The four render checks in `scripts/` are `.tsx`. The root tsconfig sets
    // `jsx: "preserve"` because Next compiles the app, so the transform has to
    // be named here instead of inherited. This replaces the old
    // `tsx --tsconfig scripts/tsconfig.render.json` invocations.
    jsx: "automatic",
  },
  resolve: {
    alias: [
      { find: /^@api\/(.*)$/, replacement: path.resolve(rootDir, "../api/src/$1") },
      { find: /^@\/(.*)$/, replacement: path.resolve(rootDir, "./$1") },
    ],
  },
  test: {
    // Every check the repo owns, in one run:
    //  - `*.test.ts(x)` anywhere outside node_modules / cypress (node:test files
    //    converted to Vitest), and
    //  - `scripts/regression-checks.test.ts`, which enumerates and wraps every
    //    `scripts/*-checks.*` side-effecting script.
    include: ["**/*.test.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "cypress/**",
      // Nested git worktrees. `.slim/worktrees/<branch>` holds a full second
      // copy of this repo, so without this the run globs every test twice —
      // once here and once against whatever branch that worktree is parked on.
      // Locally that surfaced as 160 files / 78 failures instead of 84 / 0; CI
      // never saw it because a fresh clone has no `.slim`.
      "**/.slim/**",
      // Driven as a child process by scripts/auth-mfa-regression-checks.ts,
      // which needs Node's --experimental-test-module-mocks. The decision to
      // leave them on node:test, and the guard on the spawn they depend on,
      // are in the NODE_TEST_HOLDOUTS block of scripts/regression-checks.test.ts
      // (RAD-568). Matched by suffix rather than an exact path so a copy of the
      // repo elsewhere cannot slip past it.
      "**/scripts/auth-callback-propagation-route.test.ts",
      "**/scripts/auth-complete-propagation-route.test.ts",
    ],
    env: {
      // Mirrors the inline env the old `test:*` scripts exported. Several
      // modules read these at import time via @t3-oss/env-nextjs.
      NEXT_PUBLIC_POSTHOG_KEY: "test",
      NEXT_PUBLIC_TAWK_PROPERTY_ID: "test",
      NEXT_PUBLIC_TAWK_WIDGET_ID: "test",
      NODE_ENV: "test",
    },
    environment: "node",
    globals: true,
    server: {
      deps: {
        // next-intl ships extensionless ESM (`import "next/navigation"`), which
        // Node resolved for `tsx --test` but Vite will not resolve as an
        // external. Inlining routes it through Vite's resolver instead.
        inline: [/next-intl/],
      },
    },
    root: rootDir,
    // The check scripts read source with paths relative to process.cwd().
    // vitest.setup.ts pins that to the project root inside every worker.
    setupFiles: ["./vitest.setup.ts"],
  },
});
