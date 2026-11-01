/**
 * Some tests resolve files relative to `process.cwd()`. Vitest workers inherit
 * the cwd of whoever started the run, which is the project root for `pnpm test`
 * but the current directory for a bare `npx vitest` fired from a subdirectory.
 * Pinning it here means they read the same files however the run was launched.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

if (process.cwd() !== projectRoot) {
  process.chdir(projectRoot);
}
