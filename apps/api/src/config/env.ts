/**
 * Compatibility shim. New code should import from `@app/config/configuration`.
 *
 * `loadEnv` and `assertEnv` delegate to the validated Configuration module so the rest of
 * the codebase keeps its existing import path during the migration. Once every reader has
 * moved to the new module this file can be deleted.
 *
 * Canonical home for the derived environment booleans (`APP_ENV`, `IS_PROD`, `SHOULD_*`,
 * ...). They read the frozen
 * `process.env` snapshot directly; the entrypoint (server.ts / worker.ts / script
 * entrypoints) loads dotenv exactly once before delegating here.
 */
import { z } from 'zod';

import type { ConfigurationRole } from './configuration';
import {
  bootConfiguration,
  ConfigurationError,
  loadConfiguration,
} from './configuration';
import { parseTrustProxy, type TrustProxySetting } from './trust-proxy';

export type ApiEnv = Readonly<Record<string, string>>;

export type AppEnv = ApiEnv | WorkerEnv;
export type AppEnvironment = 'development' | 'production' | 'staging' | 'test';
export type AppRole = Extract<ConfigurationRole, 'api' | 'worker'>;

export type WorkerEnv = Readonly<Record<string, string>>;

export class EnvValidationError extends Error {
  readonly problems: string[];

  constructor(problems: readonly string[], role: AppRole) {
    super(
      `Invalid environment for the ${role} process. Fix all of the following:\n`
      + problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'EnvValidationError';
    this.problems = problems.slice();
  }
}

export function assertEnv(role: AppRole, source: NodeJS.ProcessEnv = process.env): void {
  if (source['NODE_ENV'] === 'test' || source['VITEST']) return;

  try {
    loadEnv({ role, source });
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(JSON.stringify({
        level: 'error',
        msg: 'Environment validation failed. Set the variables below on this app scope.',
        problems: error.problems,
        role,
      }));
    }
    throw error;
  }
}

export function loadEnv(options: { role: AppRole; source?: NodeJS.ProcessEnv }): AppEnv {
  const flat = flatten(options.source ?? process.env);
  try {
    loadConfiguration(options.role, flat);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      const problems = error.issues.map((issue) => `${issue.path === '(root)' ? '' : `${issue.path}: `}${issue.message}`);
      throw new EnvValidationError(problems, options.role);
    }
    throw error;
  }
  return flat;
}

function flatten(raw: NodeJS.ProcessEnv | undefined): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!raw) return result;
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    result[key] = value;
  }
  return result;
}

const appEnvironmentSchema = z.enum(['development', 'production', 'staging', 'test']);

function resolveAppEnv(): AppEnvironment {
  const candidates = [process.env['APP_ENV'], process.env['DEPLOY_ENV'], process.env['NODE_ENV']];
  let resolved: AppEnvironment | undefined;
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const parsed = appEnvironmentSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(`Invalid app environment: ${candidate}`);
    }
    resolved ??= parsed.data;
  }
  return resolved ?? 'development';
}

const appEnv: AppEnvironment = resolveAppEnv();

export const APP_ENV: AppEnvironment = appEnv;
export const DEPLOY_ENV = process.env['DEPLOY_ENV'];
export const NODE_ENV = process.env['NODE_ENV'];

export const IS_PROD = appEnv === 'production';
export const IS_STAGING = appEnv === 'staging';
export const IS_TEST = appEnv === 'test';
export const IS_DEV = appEnv === 'development';

export const IS_PRODUCTION_LIKE = IS_PROD || IS_STAGING;
export const SHOULD_PRETTY_LOGS = IS_DEV;
export const SHOULD_DEBUG_SQL = IS_DEV;
export const SHOULD_ENABLE_SENTRY = Boolean(process.env['SENTRY_DSN']) && IS_PRODUCTION_LIKE;
export const SHOULD_INTERCEPT_EMAILS = !IS_PRODUCTION_LIKE && !process.env['EMAIL_DELIVERY_MODE'];

/** Proxies allowed to report the client address. See `config/trust-proxy.ts`. */
export const TRUST_PROXY: TrustProxySetting = parseTrustProxy(process.env['TRUST_PROXY']);

// Re-export bootConfiguration so the worker entrypoint can switch to it incrementally
// without changing the rest of its file.
export { bootConfiguration };
