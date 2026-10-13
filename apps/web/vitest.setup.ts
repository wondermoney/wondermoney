/**
 * Every `scripts/*-checks.*` module resolves the source it inspects with paths
 * relative to `process.cwd()` (`readFileSync("package.json")`,
 * `read("app/[locale]/…")`). Vitest workers inherit the cwd of whoever started
 * the run, which is the project root for `pnpm test` but the current directory
 * for a bare `npx vitest` fired from a subdirectory. Pinning it here means the
 * checks read the same files however the run was launched.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

if (process.cwd() !== projectRoot) {
  process.chdir(projectRoot);
}
