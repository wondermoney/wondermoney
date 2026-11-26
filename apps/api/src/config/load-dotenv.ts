/**
 * Load the API's `.env` into the process environment: the one way every entrypoint does it (the
 * server and worker through `bootConfiguration` and their imports, `migrate.ts`, the MikroORM CLI
 * config, the `assert-local-db` guard).
 *
 * Precedence, as `apps/api/CLAUDE.md` ("Database safety") states it:
 *
 *   1. A variable already set in the process environment wins; `.env` never replaces it, even
 *      when `DOTENV_CONFIG_OVERRIDE` is set (`override` is passed explicitly).
 *   2. Within `.env`, the last assignment of a key wins.
 *
 * The file is `.env` in the working directory, which is `apps/api` for every package script and
 * the images' `WORKDIR`; `DOTENV_CONFIG_PATH` still points it elsewhere (the test setup points it
 * at `/dev/null`). A missing file is not an error. Calling it again changes nothing already set.
 *
 * Plain TypeScript with no path aliases, so `scripts/*.mjs` can import it under Node's type
 * stripping.
 */
import dotenv from 'dotenv';

export interface LoadDotenvOptions {
  /** A file other than `.env` in the working directory. */
  readonly path?: string;
  /** The environment to fill; `process.env` when omitted. */
  readonly processEnv?: Record<string, string>;
}

export function loadDotenv(options: LoadDotenvOptions = {}): void {
  dotenv.config({
    override: false,
    quiet: true,
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.processEnv === undefined ? {} : { processEnv: options.processEnv }),
  });
}
