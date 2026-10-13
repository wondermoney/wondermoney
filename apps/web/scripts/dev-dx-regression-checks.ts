import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const claude = readFileSync("CLAUDE.md", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");
const middleware = readFileSync("proxy.ts", "utf8");
const providers = readFileSync("app/providers.tsx", "utf8");

assert.equal(
  packageJson.scripts.dev,
  "next dev --turbopack",
  "pnpm dev should use Turbopack by default for faster local navigation builds",
);

assert.equal(
  packageJson.scripts["dev:webpack"],
  "next dev",
  "Webpack dev mode should remain available as an explicit fallback through plain next dev",
);

assert.equal(
  packageJson.scripts["dev:wdyr"],
  "NEXT_PUBLIC_ENABLE_WDYR=1 next dev",
  "why-did-you-render should be available through an explicit Webpack-based dev script",
);

assert.equal(
  packageJson.scripts["dev:worktree"],
  "pnpm dev:webpack -p 3000",
  "worktree E2E should have an explicit Webpack dev command pinned to port 3000",
);

assert.equal(
  packageJson.scripts["e2e:worktree:preflight"],
  "tsx scripts/worktree-e2e-preflight.ts",
  "worktree E2E preflight should be runnable from package scripts",
);

assert.match(
  nextConfig,
  /process\.env\.NEXT_PUBLIC_ENABLE_WDYR\s*===\s*["']1["']/,
  "why-did-you-render should be opt-in via NEXT_PUBLIC_ENABLE_WDYR",
);

assert.match(
  nextConfig,
  /turbopack:\s*{\s*root:\s*__dirname\s*}/,
  "Turbopack should use this app directory as root to avoid worktree lockfile ambiguity",
);

assert.match(
  claude,
  /pnpm dev:webpack -p 3000|worktree E2E|e2e:worktree:preflight/,
  "CLAUDE.md should document the worktree Webpack dev path and preflight command",
);

assert.match(
  middleware,
  /api\|trpc\|health\|_next\|_vercel\|\.\*\\\\\.\.\*/,
  "middleware matcher should exclude API, internal Next/Vercel paths, health checks, and dotted static assets",
);

assert.doesNotMatch(
  providers,
  /@tanstack\/react-query-devtools/,
  "React Query Devtools should not be statically imported into global providers",
);

console.log("Dev DX regression checks passed");
