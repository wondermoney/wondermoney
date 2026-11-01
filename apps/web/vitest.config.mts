import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  oxc: {
    // The root tsconfig sets `jsx: "preserve"` because Next compiles the app,
    // so the transform for `.test.tsx` files has to be named here instead of
    // inherited.
    jsx: "automatic",
  },
  resolve: {
    alias: [
      { find: /^@api\/(.*)$/, replacement: path.resolve(rootDir, "../api/src/$1") },
      { find: /^@\/(.*)$/, replacement: path.resolve(rootDir, "./$1") },
    ],
  },
  test: {
    // Every `*.test.ts(x)` outside node_modules / cypress, in one run.
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
    ],
    env: {
      // Mirrors the inline env the old `test:*` scripts exported. Several
      // modules read these at import time via @t3-oss/env-nextjs.
      NEXT_PUBLIC_POSTHOG_KEY: "test",
      NEXT_PUBLIC_TAWK_PROPERTY_ID: "test",
      NEXT_PUBLIC_TAWK_WIDGET_ID: "test",
      NODE_ENV: "test",
    },
    // theme/contrast.test.ts reads the colour tokens via `globals.css?raw`;
    // vitest stubs every other stylesheet to an empty string.
    css: { include: [/theme\/globals\.css/] },
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
    // Some tests resolve fixture paths relative to process.cwd().
    // vitest.setup.ts pins that to the project root inside every worker.
    setupFiles: ["./vitest.setup.ts"],
  },
});
