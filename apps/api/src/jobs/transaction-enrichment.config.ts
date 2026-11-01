import { resolveAiRoute } from '@service/ai/ai-provider';

export interface TransactionEnrichmentConfig {
  dailyTenantBudget: number;
  enabled: boolean;
  expirationSeconds: number;
  mode: TransactionEnrichmentGptMode;
  modelVersion: string;
  promptVersion: string;
  retentionSeconds: number;
  retryDelaySeconds: number;
  retryLimit: number;
  writeConfidenceThreshold: number;
}

export type TransactionEnrichmentGptMode = 'off' | 'shadow' | 'write';

type EnvLike = Partial<Record<string, string | undefined>>;

const parseBoolean = (name: string, value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase();
  if (['1', 'on', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid ${name} env value: ${value}`);
};

const parseMode = (name: string, value: string | undefined, fallback: TransactionEnrichmentGptMode): TransactionEnrichmentGptMode => {
  if (value === undefined) return fallback;
  if (value === 'off' || value === 'shadow' || value === 'write') return value;
  throw new Error(`Invalid ${name} env value: ${value}`);
};

const parseInteger = (name: string, value: string | undefined, fallback: number, min?: number) => {
  if (value === undefined) return fallback;
  if (!/^-?\d+$/.test(value)) throw new Error(`Invalid ${name} env value: ${value}`);
  const parsed = Number.parseInt(value, 10);
  if (min !== undefined && parsed < min) throw new Error(`Invalid ${name} env value: ${value}`);
  return parsed;
};

const parseUnitInterval = (name: string, value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error(`Invalid ${name} env value: ${value}`);
  return parsed;
};

/**
 * Enrichments a single tenant may cost us per day.
 *
 * A runway safeguard, not a throughput dial: DeepSeek-V4-Flash is the cheapest model in the
 * stack precisely so this number can be generous. `TRANSACTION_ENRICHMENT_GPT_DAILY_TENANT_BUDGET`
 * overrides it without a redeploy if spend needs pulling back in a hurry.
 */
const DEFAULT_DAILY_TENANT_BUDGET = 600;

/**
 * Queue mechanics. Deliberately constants rather than env vars.
 *
 * No environment has ever set any of them, and unlike the budget and the kill switch below
 * there is no scenario where you would want them to differ between prod and staging — they
 * describe how pg-boss should treat this queue, which is a property of the work, not of the
 * deployment. `financial-emails.queue.ts` hardcodes the same knobs for the same reason.
 */
const JOB_EXPIRATION_SECONDS = 300;
const JOB_RETENTION_SECONDS = 1_209_600;
const JOB_RETRY_DELAY_SECONDS = 60;
const JOB_RETRY_LIMIT = 3;

/**
 * The prompt this code actually sends, stamped on every enrichment row.
 *
 * A constant, not an env var, because it is a *label* — nothing selects a prompt by version;
 * the text lives in `services/transaction-enrichment/prompt.ts`. Overriding it from the
 * environment would stamp rows produced by this prompt with some other version's name, which
 * corrupts the one record you would use to compare prompt performance. Change it in the same
 * commit that changes the prompt.
 */
const PROMPT_VERSION = 'transaction-enrichment-v1';

// On by default wherever a model provider is configured (see `services/ai/ai-provider.ts`):
// the pipeline enriches uncategorized transactions and applies the model's suggestion (`write`) with
// no further env var. A server with no provider has it off, so nothing is enqueued only to fail.
// `TRANSACTION_ENRICHMENT_GPT_ENABLED` remains a single emergency kill switch (set it to `false` to
// stop all AI calls without a redeploy), and the per-tenant/day budget caps spend.
export const buildTransactionEnrichmentConfig = (env: EnvLike = process.env): TransactionEnrichmentConfig => {
  const route = resolveAiRoute('enrichment', env);
  return {
  dailyTenantBudget: parseInteger(
    'TRANSACTION_ENRICHMENT_GPT_DAILY_TENANT_BUDGET',
    env['TRANSACTION_ENRICHMENT_GPT_DAILY_TENANT_BUDGET'],
    DEFAULT_DAILY_TENANT_BUDGET,
    0,
  ),
  enabled: parseBoolean('TRANSACTION_ENRICHMENT_GPT_ENABLED', env['TRANSACTION_ENRICHMENT_GPT_ENABLED'], true) && route.kind !== 'disabled',
  expirationSeconds: JOB_EXPIRATION_SECONDS,
  mode: parseMode('TRANSACTION_ENRICHMENT_GPT_MODE', env['TRANSACTION_ENRICHMENT_GPT_MODE'], 'write'),
  modelVersion: env['TRANSACTION_ENRICHMENT_GPT_MODEL_VERSION'] ?? (route.kind === 'openai-compatible' ? route.model : 'DeepSeek-V4-Flash'),
  promptVersion: PROMPT_VERSION,
  retentionSeconds: JOB_RETENTION_SECONDS,
  retryDelaySeconds: JOB_RETRY_DELAY_SECONDS,
  retryLimit: JOB_RETRY_LIMIT,
  writeConfidenceThreshold: parseUnitInterval('TRANSACTION_ENRICHMENT_GPT_WRITE_CONFIDENCE_THRESHOLD', env['TRANSACTION_ENRICHMENT_GPT_WRITE_CONFIDENCE_THRESHOLD'], 0.7),
  };
};
