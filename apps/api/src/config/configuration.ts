/**
 * The single validated entry point for environment configuration.
 *
 * ## Why this exists
 *
 * Without one validated entry point, secrets end up non-null-asserted, defaulted to `''`, or
 * thrown lazily from deep inside a request handler. Three consequences this module prevents:
 *
 *   1. **Missing secrets stay hidden.** `EODHD_API_KEY` is only consulted on the first
 *      market-data call. On `prod-worker`, whose only consumers are two scheduled price
 *      jobs, that call may not happen for weeks — so a key missing on one of four
 *      independent Coolify scopes is invisible until a job silently dies.
 *   2. **Silent degradation.** A missing required integration setting could collapse an
 *      issuer or endpoint to `''` rather than failing.
 *   3. **Import-order fragility.** ESM evaluates static imports before the importing module
 *      body, so an `assertEnv` call placed *after* a top-level `import './app'` cannot
 *      validate the dependencies it pulled in.
 *
 * ## The design
 *
 * - `loadConfiguration(role, source)` is **pure** — it takes a frozen source object as a
 *   parameter. Tests pass an explicit object; production callers pass the result of
 *   `bootConfiguration`.
 * - **Per-role and per-operation schemas.** The API must never demand `POSTHOG_API_KEY`;
 *   migrations and operational scripts validate exactly what they need and nothing else.
 * - **One aggregated error.** Every problem is reported at once, not one redeploy at a
 *   time. The error never includes secret values.
 * - `bootConfiguration(role)` is the **only** place in the codebase that reads
 *   `process.env` or calls `dotenv.config()`. The returned value is deeply immutable.
 * - Migration status: this module is the destination. `utils/constants.ts` and
 *   direct `dotenv.config()` calls are old readers still kept for compatibility;
 *   the ESLint restriction plus source-scan test reject new direct readers.
 */
import dotenv from 'dotenv';
import { z } from 'zod';

import { defaultBrowserOrigins, resolveAppUrl } from './instance-urls';
import { parseTrustProxy, TrustProxyError } from './trust-proxy';

export interface ConfigurationIssue {
  readonly code: 'conflict' | 'invalid-format' | 'invalid-value' | 'missing' | 'role-invariant';
  readonly message: string;
  readonly path: string;
}

export type ConfigurationSource = Readonly<Record<string, string | undefined>>;

export class ConfigurationError extends Error {
  readonly issues: readonly ConfigurationIssue[];
  readonly role: ConfigurationRole;

  constructor(role: ConfigurationRole, issues: readonly ConfigurationIssue[]) {
    super(
      `Invalid configuration for the ${role} target. Fix all of the following:\n`
      + issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n'),
    );
    this.name = 'ConfigurationError';
    this.role = role;
    this.issues = issues;
  }
}

// -- Reusable primitives ---------------------------------------------------

const nonEmpty = (description: string) => z.string({ error: description }).trim().min(1, description);

const base64Key = (bytes: number, description: string) => z.string({ error: description }).trim()
  .refine((value) => {
    if (!/^[a-z0-9+/]+={0,2}$/i.test(value)) return false;
    return Buffer.from(value, 'base64').length === bytes;
  }, `${description} (must be base64 decoding to exactly ${bytes} bytes; generate with \`openssl rand -base64 ${bytes}\`)`);

const httpUrl = (description: string) => z.string().trim().pipe(z.url(description))
  .refine((v) => v.startsWith('http://') || v.startsWith('https://'), `${description} (must be http or https)`);

const positiveInt = (description: string) => z.string().trim()
  .refine((v) => /^\d+$/.test(v) && Number(v) > 0, `${description} (must be a positive integer)`);

const boolFlag = (description: string) => z.enum(['1', '0', 'true', 'false', 'on', 'off', 'yes', 'no'], {
  error: `${description} (must be one of 1/0/true/false/on/off/yes/no)`,
});

// -- Runtime and shared schema --------------------------------------------

const runtimeSchema = z.object({
  ACCOUNT_AUTO_SYNC_MAX_ENQUEUED: positiveInt('Account auto-sync enqueue cap').optional(),
  API_URL: httpUrl('API base URL').optional(),
  APP_ENV: z.string().trim().optional(),
  APP_URL: httpUrl('Web app base URL').optional(),
  CORS_ALLOWED_ORIGINS: z.string().trim().optional(),
  DEPLOY_ENV: z.string().trim().optional(),
  INSTANCE_NAME: z.string().trim().optional(),
  MIN_APP_VERSION: z.string().trim().regex(/^\d+\.\d+\.\d+$/u, 'MIN_APP_VERSION must be a semver version such as 2.1.0').optional(),
  NODE_ENV: z.enum(['development', 'production', 'staging', 'test']).default('development'),
  PGBOSS_SCHEDULER_MODE: z.enum(['off', 'internal-allowlist', 'live']).optional(),
  PGBOSS_SUPERVISE_TIMEOUT_MS: positiveInt('Worker supervise timeout').optional(),
  PORT: positiveInt('HTTP port').optional(),
  PRIVACY_POLICY_URL: z.string().trim().optional(),
  PUBLIC_DIAGNOSTICS_ENABLED: boolFlag('Public diagnostics flag').optional(),
  SIGNUP_MODE: z.enum(['open', 'invite', 'closed']).optional(),
  TRUST_PROXY: z.string().trim().superRefine((value, ctx) => {
    try {
      parseTrustProxy(value);
    } catch (error) {
      if (!(error instanceof TrustProxyError)) throw error;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: error.message });
    }
  }).optional(),
  WORKER_HEALTH_PORT: positiveInt('Worker health port').optional(),
});

// better-auth / social sign-in. Every key is optional: Apple and Google sign-in are each
// independently optional, and the worker never constructs better-auth. Requiredness is
// enforced where the value is consumed (`IS_PRODUCTION_LIKE` secret check in
// `services/auth/better-auth.ts`), mirroring how the `database` block validates at its use.
const authSchema = z.object({
  APPLE_CLIENT_ID: z.string().trim().optional(),
  APPLE_CLIENT_SECRET: z.string().trim().optional(),
  APPLE_NATIVE_AUDIENCE: z.string().trim().optional(),
  AUTH_COOKIE_DOMAIN: z.string().trim().optional(),
  AUTH_COOKIE_PREFIX: z.string().trim().regex(/^[\w.-]+$/u, 'AUTH_COOKIE_PREFIX may only contain letters, digits, dots, dashes and underscores').optional(),
  BETTER_AUTH_SECRET: z.string().trim().optional(),
  BETTER_AUTH_URL: httpUrl('Better Auth base URL').optional(),
  GOOGLE_CLIENT_ID: z.string().trim().optional(),
  GOOGLE_CLIENT_SECRET: z.string().trim().optional(),
});

// Third-party integrations are all optional: a self-hosted install boots with Postgres and its own
// secrets, and each feature whose integration is unset reports itself disabled (`GET /v1/configs`).
// What *is* validated is the shape of a value that is present.
const sharedSchema = z.object({
  AWS_ACCESS_KEY_ID: z.string().trim().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().trim().optional(),
  CREDENTIAL_ENCRYPTION_KEY_V1: base64Key(32, 'Enable Banking credential encryption key is required'),
  DATABASE_URL: z.string().trim().optional(),
  DB_DATABASE: z.string().trim().optional(),
  DB_HOST: z.string().trim().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_PORT: z.string().trim().optional(),
  DB_USERNAME: z.string().trim().optional(),
  EMAIL_OPT_OUT_SIGNING_SECRET: nonEmpty('Unsubscribe-link signing secret is required (minted by worker emails, verified by the API)'),
  S3_BUCKET: z.string().trim().optional(),
  S3_ENDPOINT: httpUrl('S3 endpoint').optional(),
  S3_FORCE_PATH_STYLE: boolFlag('S3 path-style flag').optional(),
  S3_PUBLIC_ENDPOINT: httpUrl('S3 public endpoint').optional(),

  S3_REGION: z.string().trim().optional(),

  // AI: Azure (see services/ai/ai-provider.ts) or any OpenAI-compatible endpoint.
  AI_API_KEY: z.string().trim().optional(),
  AI_BASE_URL: httpUrl('AI base URL').optional(),
  AI_MODEL: z.string().trim().optional(),
  AI_MODEL_ASSISTANT: z.string().trim().optional(),
  AI_MODEL_CSV_MAPPING: z.string().trim().optional(),
  AI_MODEL_ENRICHMENT: z.string().trim().optional(),
  AI_MODEL_MONTHLY_STORY: z.string().trim().optional(),
  AI_MODEL_OCR: z.string().trim().optional(),
  AZURE_AI_FOUNDRY_API_KEY: z.string().trim().optional(),
  AZURE_AI_FOUNDRY_API_VERSION: z.string().trim().optional(),
  AZURE_AI_FOUNDRY_ENDPOINT: httpUrl('Azure AI Foundry endpoint').optional(),
  AZURE_OPENAI_API_KEY: z.string().trim().optional(),
  AZURE_OPENAI_API_VERSION: z.string().trim().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().trim().optional(),
  AZURE_OPENAI_ENDPOINT: httpUrl('Azure OpenAI endpoint').optional(),
  AZURE_OPENAI_OCR_DEPLOYMENT: z.string().trim().optional(),
  EODHD_API_KEY: z.string().trim().optional(),

  // Defaults live in jobs/pgboss.config.ts.
  PGBOSS_MIGRATE: boolFlag('pg-boss migrate flag').optional(),
  PGBOSS_PERSIST_WARNINGS: boolFlag('pg-boss persist-warnings flag').optional(),
  PGBOSS_SCHEDULE: boolFlag('pg-boss schedule flag').optional(),
  PGBOSS_SCHEMA: z.string().trim().regex(/^[a-z_][a-z0-9_]*$/u, 'pg-boss schema must be a plain identifier').optional(),
  PGBOSS_SUPERVISE: boolFlag('pg-boss supervise flag').optional(),

  // Email: Resend, SMTP or (unset) the log driver — see services/email/email-transport.ts.
  EMAIL_DRIVER: z.enum(['log', 'resend', 'smtp']).optional(),
  EMAIL_FROM: z.string().trim().pipe(z.email('Email sender must be a valid address')).optional(),
  EMAIL_FROM_NAME: z.string().trim().optional(),
  RESEND_API_KEY: z.string().trim().optional(),
  // Deprecated aliases of EMAIL_FROM / EMAIL_FROM_NAME, still read as fallbacks by
  // `emailSender` because the hosted instance sets them. Remove once it is renamed.
  RESEND_FROM_EMAIL: z.string().trim().pipe(z.email('Resend from-address must be a valid email')).optional(),
  RESEND_FROM_NAME: z.string().trim().optional(),
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_PORT: positiveInt('SMTP port').optional(),
  SMTP_SECURE: boolFlag('SMTP implicit-TLS flag').optional(),
  SMTP_USER: z.string().trim().optional(),
  SUPPORT_EMAIL: z.string().trim().pipe(z.email('Support inbox must be a valid address')).optional(),
});

const apiSchema = sharedSchema.extend({
  ...authSchema.shape,
  ADMIN_API_KEY: nonEmpty('Admin API key is required (admin routes fail closed without it)'),
  INTERNAL_SERVICE_API_KEY: nonEmpty('Internal service key is required'),
  RECAPTCHA_SECRET_KEY: z.string().trim().optional(),
});

const workerSchema = sharedSchema.extend({
  ENABLE_PGBOSS_DEMO_DATA_REFRESH: boolFlag('Demo-data refresh flag (worker only)').optional(),
  HETRIX_WORKER_HEARTBEAT_URL: z.string().trim().optional(),
  PGBOSS_QUEUE_DEPTH_MONITOR_ENABLED: boolFlag('Queue depth monitor flag').optional(),
  POSTHOG_API_KEY: z.string().trim().optional(),
  POSTHOG_HOST: httpUrl('PostHog host').optional(),
  TRANSACTION_ENRICHMENT_GPT_MODEL_VERSION: z.string().trim().optional(),
});

// -- Operation schemas -----------------------------------------------------

const migrationSchema = sharedSchema;

const ormCliSchema = sharedSchema;

const localDbGuardSchema = z.object({
  ALLOW_REMOTE_WRITE: boolFlag('Allow remote write flag').optional(),
  DB_DATABASE: z.string().trim().optional(),
  DB_HOST: z.string().trim().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_PORT: z.string().trim().optional(),
  DB_USERNAME: z.string().trim().optional(),
});

const recoverySchema = sharedSchema.extend({
  PGBOSS_RECOVERY_DRY_RUN: boolFlag('Recovery dry-run flag'),
});

const portfolioImportSmokeSchema = sharedSchema;

// -- Helpers ---------------------------------------------------------------

function bool(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

function buildAuth(parsed: z.infer<typeof authSchema>) {
  return {
    appleClientId: parsed.APPLE_CLIENT_ID ?? null,
    appleClientSecret: parsed.APPLE_CLIENT_SECRET ?? null,
    appleNativeAudience: parsed.APPLE_NATIVE_AUDIENCE ?? null,
    betterAuthSecret: parsed.BETTER_AUTH_SECRET ?? null,
    betterAuthUrl: parsed.BETTER_AUTH_URL ?? null,
    cookieDomain: parsed.AUTH_COOKIE_DOMAIN ?? null,
    googleClientId: parsed.GOOGLE_CLIENT_ID ?? null,
    googleClientSecret: parsed.GOOGLE_CLIENT_SECRET ?? null,
  };
}

function buildDatabase(parsed: { DATABASE_URL?: string; DB_DATABASE?: string; DB_HOST?: string; DB_PASSWORD?: string; DB_PORT?: string; DB_USERNAME?: string; }) {
  if (parsed.DATABASE_URL) {
    return {
      connectionString: parsed.DATABASE_URL,
      database: null as null | string,
      host: null as null | string,
      password: null as null | string,
      port: null as null | number,
      username: null as null | string,
    };
  }
  if (parsed.DB_HOST && parsed.DB_PORT && parsed.DB_DATABASE && parsed.DB_USERNAME) {
    return {
      connectionString: null as null | string,
      database: parsed.DB_DATABASE,
      host: parsed.DB_HOST,
      password: parsed.DB_PASSWORD ?? null,
      port: Number(parsed.DB_PORT),
      username: parsed.DB_USERNAME,
    };
  }
  return {
    connectionString: null,
    database: null,
    host: null,
    password: null,
    port: null,
    username: null,
  } as const;
}

function buildIntegrations(parsed: z.infer<typeof sharedSchema>) {
  return {
    azureAiFoundry: {
      apiKey: parsed.AZURE_AI_FOUNDRY_API_KEY,
      apiVersion: parsed.AZURE_AI_FOUNDRY_API_VERSION,
      endpoint: parsed.AZURE_AI_FOUNDRY_ENDPOINT,
    },
    azureOpenAi: {
      apiKey: parsed.AZURE_OPENAI_API_KEY,
      apiVersion: parsed.AZURE_OPENAI_API_VERSION,
      deployment: parsed.AZURE_OPENAI_DEPLOYMENT,
      endpoint: parsed.AZURE_OPENAI_ENDPOINT,
      ocrDeployment: parsed.AZURE_OPENAI_OCR_DEPLOYMENT,
    },
    credentialEncryptionKey: parsed.CREDENTIAL_ENCRYPTION_KEY_V1,
    emailOptOutSigningSecret: parsed.EMAIL_OPT_OUT_SIGNING_SECRET,
    eodhdApiKey: parsed.EODHD_API_KEY,
    resend: {
      apiKey: parsed.RESEND_API_KEY,
    },
    s3: {
      accessKeyId: parsed.AWS_ACCESS_KEY_ID,
      secretAccessKey: parsed.AWS_SECRET_ACCESS_KEY,
    },
  };
}

function buildPgBoss(parsed: z.infer<typeof sharedSchema>) {
  return {
    connectionString: parsed.DATABASE_URL ?? null,
    migrate: bool(parsed.PGBOSS_MIGRATE),
    persistWarnings: bool(parsed.PGBOSS_PERSIST_WARNINGS),
    schedule: bool(parsed.PGBOSS_SCHEDULE),
    schema: parsed.PGBOSS_SCHEMA,
    supervise: bool(parsed.PGBOSS_SUPERVISE),
  };
}

function buildRuntime(parsed: z.infer<typeof runtimeSchema>) {
  const nodeEnv = parsed.NODE_ENV;
  const appEnv = parseAppEnvironment(parsed.APP_ENV ?? parsed.DEPLOY_ENV ?? nodeEnv);
  const isProductionLike = appEnv === 'production' || appEnv === 'staging';
  return {
    appEnv,
    diagnosticsEnabled: bool(parsed.PUBLIC_DIAGNOSTICS_ENABLED),
    isDev: appEnv === 'development',
    isProduction: appEnv === 'production',
    isProductionLike,
    isStaging: appEnv === 'staging',
    isTest: appEnv === 'test',
    nodeEnv,
    port: parsed.PORT ? Number(parsed.PORT) : null,
    shouldDebugSql: appEnv === 'development',
  };
}

function freeze<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze)) as unknown as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const next: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      next[key] = freeze(inner);
    }
    return Object.freeze(next) as unknown as T;
  }
  return value;
}

function parseAppEnvironment(value: string | undefined): 'development' | 'production' | 'staging' | 'test' {
  const candidate = (value ?? '').trim().toLowerCase();
  if (candidate === 'production') return 'production';
  if (candidate === 'staging') return 'staging';
  if (candidate === 'test') return 'test';
  return 'development';
}

function parseIssues(error: z.ZodError, source: ConfigurationSource): ConfigurationIssue[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    // Zod 4 does not say "Required" for an absent key (and issues carry no `input` unless
    // `reportInput` is on), so "missing" is decided from the source itself.
    const absent = issue.path.length === 1 && source[String(issue.path[0])] === undefined;
    const code: ConfigurationIssue['code'] = issue.code === 'invalid_type' && absent ? 'missing' : 'invalid-value';
    return { code, message: issue.message, path };
  });
}

// -- Result types ----------------------------------------------------------

export interface ApiConfiguration {
  readonly auth: ReturnType<typeof buildAuth>;
  readonly database: ReturnType<typeof buildDatabase>;
  readonly features: {
    readonly accountAutoSyncMaxEnqueued: null | number;
  };
  readonly http: {
    readonly corsAllowedOrigins: readonly string[];
    readonly diagnosticsEnabled: boolean;
    readonly port: null | number;
  };
  readonly integrations: ReturnType<typeof buildIntegrations>;
  readonly pgBoss: ReturnType<typeof buildPgBoss>;
  readonly role: 'api';
  readonly runtime: ReturnType<typeof buildRuntime>;
}

export interface ConfigurationByRole {
  api: ApiConfiguration;
  migration: MigrationConfiguration;
  'operation:local-db-guard': LocalDbGuardConfiguration;
  'operation:portfolio-import-smoke': PortfolioImportSmokeConfiguration;
  'operation:recovery': RecoveryConfiguration;
  'orm-cli': OrmCliConfiguration;
  worker: WorkerConfiguration;
}

export type ConfigurationRole = keyof ConfigurationByRole;

export interface LocalDbGuardConfiguration {
  readonly allowRemoteWrite: boolean;
  readonly database: ReturnType<typeof buildDatabase>;
  readonly role: 'operation:local-db-guard';
}

export interface MigrationConfiguration {
  readonly database: ReturnType<typeof buildDatabase>;
  readonly role: 'migration';
  readonly runtime: ReturnType<typeof buildRuntime>;
}

export interface OrmCliConfiguration {
  readonly database: ReturnType<typeof buildDatabase>;
  readonly role: 'orm-cli';
  readonly runtime: ReturnType<typeof buildRuntime>;
}

export interface PortfolioImportSmokeConfiguration {
  readonly database: ReturnType<typeof buildDatabase>;
  readonly role: 'operation:portfolio-import-smoke';
  readonly runtime: ReturnType<typeof buildRuntime>;
}

export interface RecoveryConfiguration {
  readonly database: ReturnType<typeof buildDatabase>;
  readonly dryRun: boolean;
  readonly pgBoss: ReturnType<typeof buildPgBoss>;
  readonly role: 'operation:recovery';
  readonly runtime: ReturnType<typeof buildRuntime>;
}

export interface WorkerConfiguration {
  readonly database: ReturnType<typeof buildDatabase>;
  readonly health: { readonly port: null | number };
  readonly integrations: ReturnType<typeof buildIntegrations>;
  readonly jobs: {
    readonly analytics: { readonly posthogApiKey: null | string };
    readonly demoDataRefresh: boolean;
    readonly enrichment: {
      readonly gptModelVersion: null | string;
      readonly schedulerMode: 'internal-allowlist' | 'live' | 'off' | null;
    };
    readonly heartbeatEnabled: boolean;
    readonly heartbeatUrl: null | string;
    readonly queueDepthMonitorEnabled: boolean;
    readonly superviseTimeoutMs: null | number;
  };
  readonly pgBoss: ReturnType<typeof buildPgBoss>;
  readonly role: 'worker';
  readonly runtime: ReturnType<typeof buildRuntime>;
}

function defaultOrigins(runtime: ReturnType<typeof buildRuntime>, parsed: z.infer<typeof runtimeSchema>): readonly string[] {
  const explicit = parsed.CORS_ALLOWED_ORIGINS;
  if (explicit && explicit.trim().length > 0) return parseOrigins(explicit);
  return localOrigins(runtime, parsed);
}

function localOrigins(runtime: ReturnType<typeof buildRuntime>, parsed: z.infer<typeof runtimeSchema>): readonly string[] {
  const appEnv = runtime.isProduction ? 'production' : runtime.isStaging ? 'staging' : 'development';
  return defaultBrowserOrigins(appEnv, resolveAppUrl({ APP_URL: parsed.APP_URL }, appEnv));
}

function parseOrigins(value: string): readonly string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return '';
      }
    })
    .filter((origin): origin is string => origin !== '');
}

function parseRole<R extends ConfigurationRole>(role: R, source: ConfigurationSource): ConfigurationByRole[R] {
  const runtimeParsed = runtimeSchema.safeParse(source);
  if (!runtimeParsed.success) {
    throw new ConfigurationError(role, parseIssues(runtimeParsed.error, source));
  }
  const runtime = buildRuntime(runtimeParsed.data);

  if (role === 'api') {
    const parsed = apiSchema.safeParse(source);
    if (!parsed.success) throw new ConfigurationError(role, parseIssues(parsed.error, source));
    const db = buildDatabase(parsed.data);
    const issues = requireDbOrThrow(db, role);
    if (issues.length > 0) throw new ConfigurationError(role, issues);
    const config: ApiConfiguration = {
      auth: buildAuth(parsed.data),
      database: db,
      features: {
        accountAutoSyncMaxEnqueued: runtimeParsed.data.ACCOUNT_AUTO_SYNC_MAX_ENQUEUED
          ? Number(runtimeParsed.data.ACCOUNT_AUTO_SYNC_MAX_ENQUEUED)
          : null,
      },
      http: {
        corsAllowedOrigins: defaultOrigins(runtime, runtimeParsed.data),
        diagnosticsEnabled: runtime.diagnosticsEnabled,
        port: runtime.port,
      },
      integrations: buildIntegrations(parsed.data),
      pgBoss: buildPgBoss(parsed.data),
      role: 'api',
      runtime,
    };
    return freeze(config) as ConfigurationByRole[R];
  }

  if (role === 'worker') {
    const parsed = workerSchema.safeParse(source);
    if (!parsed.success) throw new ConfigurationError(role, parseIssues(parsed.error, source));
    const db = buildDatabase(parsed.data);
    const issues = requireDbOrThrow(db, role);
    if (issues.length > 0) throw new ConfigurationError(role, issues);
    const config: WorkerConfiguration = {
      database: db,
      health: { port: runtimeParsed.data.WORKER_HEALTH_PORT ? Number(runtimeParsed.data.WORKER_HEALTH_PORT) : null },
      integrations: buildIntegrations(parsed.data),
      jobs: {
        analytics: { posthogApiKey: parsed.data.POSTHOG_API_KEY ?? null },
        demoDataRefresh: bool(parsed.data.ENABLE_PGBOSS_DEMO_DATA_REFRESH),
        enrichment: {
          gptModelVersion: parsed.data.TRANSACTION_ENRICHMENT_GPT_MODEL_VERSION ?? null,
          schedulerMode: runtimeParsed.data.PGBOSS_SCHEDULER_MODE ?? null,
        },
        heartbeatEnabled: Boolean(parsed.data.HETRIX_WORKER_HEARTBEAT_URL),
        heartbeatUrl: parsed.data.HETRIX_WORKER_HEARTBEAT_URL ?? null,
        queueDepthMonitorEnabled: bool(parsed.data.PGBOSS_QUEUE_DEPTH_MONITOR_ENABLED),
        superviseTimeoutMs: runtimeParsed.data.PGBOSS_SUPERVISE_TIMEOUT_MS ? Number(runtimeParsed.data.PGBOSS_SUPERVISE_TIMEOUT_MS) : null,
      },
      pgBoss: buildPgBoss(parsed.data),
      role: 'worker',
      runtime,
    };
    return freeze(config) as ConfigurationByRole[R];
  }

  if (role === 'migration' || role === 'orm-cli') {
    const parsed = (role === 'migration' ? migrationSchema : ormCliSchema).safeParse(source);
    if (!parsed.success) throw new ConfigurationError(role, parseIssues(parsed.error, source));
    const db = buildDatabase(parsed.data);
    const issues = requireDbOrThrow(db, role);
    if (issues.length > 0) throw new ConfigurationError(role, issues);
    const config: MigrationConfiguration | OrmCliConfiguration = {
      database: db,
      role: role === 'migration' ? 'migration' : 'orm-cli',
      runtime,
    };
    return freeze(config) as ConfigurationByRole[R];
  }

  if (role === 'operation:local-db-guard') {
    const parsed = localDbGuardSchema.safeParse(source);
    if (!parsed.success) throw new ConfigurationError(role, parseIssues(parsed.error, source));
    const db = buildDatabase(parsed.data);
    const config: LocalDbGuardConfiguration = {
      allowRemoteWrite: bool(parsed.data.ALLOW_REMOTE_WRITE),
      database: db,
      role: 'operation:local-db-guard',
    };
    return freeze(config) as ConfigurationByRole[R];
  }

  if (role === 'operation:recovery') {
    const parsed = recoverySchema.safeParse(source);
    if (!parsed.success) throw new ConfigurationError(role, parseIssues(parsed.error, source));
    const db = buildDatabase(parsed.data);
    const issues = requireDbOrThrow(db, role);
    if (issues.length > 0) throw new ConfigurationError(role, issues);
    const config: RecoveryConfiguration = {
      database: db,
      dryRun: bool(parsed.data.PGBOSS_RECOVERY_DRY_RUN),
      pgBoss: buildPgBoss(parsed.data),
      role: 'operation:recovery',
      runtime,
    };
    return freeze(config) as ConfigurationByRole[R];
  }

  if (role === 'operation:portfolio-import-smoke') {
    const parsed = portfolioImportSmokeSchema.safeParse(source);
    if (!parsed.success) throw new ConfigurationError(role, parseIssues(parsed.error, source));
    const db = buildDatabase(parsed.data);
    const issues = requireDbOrThrow(db, role);
    if (issues.length > 0) throw new ConfigurationError(role, issues);
    const config: PortfolioImportSmokeConfiguration = {
      database: db,
      role: 'operation:portfolio-import-smoke',
      runtime,
    };
    return freeze(config) as ConfigurationByRole[R];
  }

  throw new ConfigurationError(role, [{ code: 'role-invariant', message: `unsupported role ${String(role)}`, path: '(role)' }]);
}

function requireDbOrThrow(parsed: ReturnType<typeof buildDatabase>, _role: ConfigurationRole): ConfigurationIssue[] {
  if (parsed.connectionString) return [];
  if (parsed.host && parsed.port && parsed.database && parsed.username) return [];
  return [{ code: 'missing', message: 'set DATABASE_URL or all of DB_HOST / DB_PORT / DB_DATABASE / DB_USERNAME', path: 'database' }];
}

/**
 * Parse and validate configuration for a given role or operation.
 *
 * Pure: pass `source` to validate an arbitrary object. Throws `ConfigurationError` listing
 * *every* problem rather than only the first. The returned object is deeply immutable.
 */
export function loadConfiguration<R extends ConfigurationRole>(role: R, source: ConfigurationSource): ConfigurationByRole[R] {
  return parseRole(role, withoutEmptyValues(source));
}

/**
 * An empty or whitespace-only variable means "not set": docker compose passes `KEY=` lines in
 * .env through as "", and an optional integration left blank must not fail validation as a
 * malformed value. A required key left blank is still reported, as missing.
 */
function withoutEmptyValues(source: ConfigurationSource): ConfigurationSource {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''));
}

/**
 * Parse only the better-auth / social sign-in block.
 *
 * `services/auth/better-auth.ts` runs at module-evaluation time, before the entrypoint's
 * `assertEnv('api')` (static imports evaluate first), so it cannot read the fully-booted API
 * configuration. This pure loader validates exactly the auth keys it needs and nothing else —
 * the same block exposed as `config.auth` on the API role — so a bad `BETTER_AUTH_URL` still
 * fails fast without demanding unrelated API secrets.
 */
export function loadAuthConfiguration(source: ConfigurationSource): ReturnType<typeof buildAuth> {
  const cleaned = withoutEmptyValues(source);
  const parsed = authSchema.safeParse(cleaned);
  if (!parsed.success) throw new ConfigurationError('api', parseIssues(parsed.error, cleaned));
  return freeze(buildAuth(parsed.data));
}

let installed: ConfigurationByRole[keyof ConfigurationByRole] | null = null;

function readProcessSource(): ConfigurationSource {
  dotenv.config({ quiet: true });
  return Object.freeze({ ...(process.env as Record<string, string | undefined>) });
}

/**
 * Validate the runtime configuration for the current process and return a deeply
 * immutable value.
 *
 * The sole place in the codebase permitted to read `process.env` or call `dotenv.config()`.
 * Subsequent calls in the same process return the cached result; calling `bootConfiguration`
 * twice with different roles throws `ConfigurationError`.
 */
export function bootConfiguration<R extends ConfigurationRole>(role: R): ConfigurationByRole[R] {
  const source = readProcessSource();
  const config = loadConfiguration(role, source);
  if (installed) {
    if (installed.role !== role) {
      throw new ConfigurationError(role, [{
        code: 'role-invariant',
        message: `bootConfiguration already ran for ${installed.role}; cannot install ${role}`,
        path: '(role)',
      }]);
    }
    return installed as ConfigurationByRole[R];
  }
  installed = config;
  return config;
}
