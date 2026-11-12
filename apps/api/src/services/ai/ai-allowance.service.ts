import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Daily per-household allowances for the AI features a person triggers directly. Each feature
 * reads its own limit (`AI_DAILY_LIMIT_ASSISTANT`, `AI_DAILY_LIMIT_OCR`,
 * `AI_DAILY_LIMIT_CSV_MAPPING`, `AI_DAILY_LIMIT_STATEMENT_IMPORT`, one per PDF statement however
 * many pages it has); unset means unlimited, so a self-hosted install is not capped.
 * The hosted instance sets them because it pays for every model call.
 *
 * Household members share one allowance: the counter is keyed on the tenant, the same unit the
 * enrichment budget uses. The day is the UTC calendar day.
 *
 * Enrichment keeps its own budget (`TRANSACTION_ENRICHMENT_GPT_DAILY_TENANT_BUDGET`), and the
 * monthly story runs once a month per person, so neither is counted here.
 */
export type AllowanceFeature = 'assistant' | 'csvMapping' | 'ocr' | 'statementImport';

type Env = Readonly<Record<string, string | undefined>>;

const LIMIT_VARIABLE: Record<AllowanceFeature, string> = {
  assistant: 'AI_DAILY_LIMIT_ASSISTANT',
  csvMapping: 'AI_DAILY_LIMIT_CSV_MAPPING',
  ocr: 'AI_DAILY_LIMIT_OCR',
  statementImport: 'AI_DAILY_LIMIT_STATEMENT_IMPORT',
};

/** The feature's daily limit, or `null` for unlimited. A malformed value counts as unset. */
export function aiDailyLimit(feature: AllowanceFeature, env: Env = process.env): null | number {
  const value = env[LIMIT_VARIABLE[feature]]?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/**
 * Spends one unit of the household's allowance for `feature` today. Returns false, spending
 * nothing, once the allowance is used up.
 *
 * One `INSERT ... ON CONFLICT DO UPDATE ... WHERE used_count < limit RETURNING` makes the check
 * and the increment one atomic step, so concurrent requests cannot overshoot the limit.
 */
export async function spendAiAllowance(
  em: EntityManager,
  tenantKey: number,
  feature: AllowanceFeature,
  { env = process.env, now = new Date() }: { env?: Env; now?: Date } = {},
): Promise<boolean> {
  const limit = aiDailyLimit(feature, env);
  if (limit === null) return true;
  if (limit <= 0) return false;

  const rows = await em.execute(
    `insert into "ai_usage_allowance" ("created_at", "updated_at", "tenant_key", "feature", "day", "used_count")
     values (now(), now(), ?, ?, ?, 1)
     on conflict ("tenant_key", "feature", "day")
     do update set "used_count" = "ai_usage_allowance"."used_count" + 1, "updated_at" = now()
       where "ai_usage_allowance"."used_count" < ?
     returning "used_count"`,
    [tenantKey, feature, now.toISOString().slice(0, 10), limit],
  );
  return Array.isArray(rows) && rows.length > 0;
}
