import { lstat, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { MikroORM } from '@mikro-orm/core';
import { z } from 'zod';

/**
 * Stratified sample for a blind precision re-measurement of the transaction-enrichment
 * categoriser (RAD-444/RAD-584). Pulls already-enriched transactions, bucketed by the
 * confidence the model reported, so a human can label each one *before* seeing the
 * model's suggestion (see the companion labelling page and score-categoriser-eval.ts).
 *
 * Read-only: does not write to the database. Excludes internal/team accounts
 * (@wonder.money, +sandbox) and demo accounts, matching the standard exclusion used
 * across growth/ops queries (docs/operations/daily_prompt.md).
 */
const BUCKETS = [
  { max: 0.65, min: 0.6 },
  { max: 0.7, min: 0.65 },
  { max: 0.75, min: 0.7 },
  { max: 0.85, min: 0.75 },
  { max: 0.95, min: 0.85 },
  { max: 1.01, min: 0.95 },
] as const;

const argsSchema = z.object({
  outputPath: z.string(),
  perBucket: z.coerce.number().int().positive().default(30),
}).strict();

type SampleRow = Readonly<{
  candidateText: null | string;
  confidence: number;
  currencyCode: null | string;
  direction: 'credit' | 'debit' | 'unknown';
  merchantSuggestion: null | string;
  reasonCode: null | string;
  settlementAmount: null | number;
  suggestedCategoryKey: number;
  suggestedCategoryName: string;
  transactionDate: null | string;
  transactionEnrichmentKey: number;
}>;

export class CategoriserEvalExportArgumentError extends Error {
  override readonly name = 'CategoriserEvalExportArgumentError';
}

export async function main(argv: readonly string[] = process.argv.slice(2)) {
  const args = parseArgs(argv);
  await assertSafeOutputPath(args.outputPath);
  const { default: config } = await import('../../mikro-orm.config');
  const orm = await MikroORM.init({ ...config, debug: false });
  try {
    const connection = orm.em.getConnection();
    const rows: SampleRow[] = [];
    for (const bucket of BUCKETS) {
      const bucketRows = await connection.execute<SampleRow[]>(
        `select te.transaction_enrichment_key as "transactionEnrichmentKey", te.confidence,
           te.category_suggestion_key as "suggestedCategoryKey", sc.name as "suggestedCategoryName",
           te.merchant_suggestion as "merchantSuggestion", te.reason_code as "reasonCode",
           coalesce(tm.name, t.description) as "candidateText",
           case when t.settlement_amount is null or t.settlement_amount = 0 then 'unknown'
             when t.settlement_amount > 0 then 'credit' else 'debit' end as "direction",
           t.settlement_amount as "settlementAmount", cur.code as "currencyCode",
           t.transaction_date as "transactionDate"
         from transaction_enrichment te
         join transaction t on t.transaction_key = te.transaction_key
         join appuser au on au.appuser_key = t.appuser_key
         left join transaction_merchant tm on tm.transaction_merchant_key = t.transaction_merchant_key
         left join currency cur on cur.currency_key = t.settlement_currency_key
         left join category sc on sc.category_key = te.category_suggestion_key
         where te.status = 'completed' and te.deleted_at is null and t.deleted_at is null
           and te.confidence >= ? and te.confidence < ? and te.category_suggestion_key is not null
           and au.account_type = 'regular' and au.email_address not like '%@wonder.money'
           and au.email_address not like '%+sandbox%'
         order by random() limit ?`,
        [bucket.min, bucket.max, args.perBucket],
        'all',
      );
      rows.push(...bucketRows);
    }
    const categories = await connection.execute<{ categoryKey: number; name: string }[]>(
      `select category_key as "categoryKey", name from category where is_system_category = true and deleted_at is null order by name`,
      [],
      'all',
    );
    const handle = await open(args.outputPath, 'wx');
    try {
      await handle.writeFile(JSON.stringify({ categories, generatedAt: new Date().toISOString(), rows }, null, 2));
    } finally {
      await handle.close();
    }
    const summary = { buckets: BUCKETS.map((bucket) => ({ ...bucket, count: rows.filter((row) => row.confidence >= bucket.min && row.confidence < bucket.max).length })), total: rows.length };
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    await orm.close(true);
  }
}

export function parseArgs(argv: readonly string[]) {
  const values: Record<string, string | undefined> = {};
  const names = new Map([['--output-path', 'outputPath'], ['--per-bucket', 'perBucket']]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const name = argument ? names.get(argument) : undefined;
    if (!name) throw new CategoriserEvalExportArgumentError(`Unknown argument: ${argument ?? ''}`);
    const value = argv[index + 1];
    if (value === undefined) throw new CategoriserEvalExportArgumentError(`Missing value for ${argument}`);
    values[name] = value;
    index += 1;
  }
  const parsed = argsSchema.safeParse(values);
  if (!parsed.success) throw new CategoriserEvalExportArgumentError(parsed.error.issues.map((issue) => issue.message).join('; '));
  return parsed.data;
}

async function assertSafeOutputPath(outputPath: string): Promise<void> {
  if (!isAbsolute(outputPath)) throw new CategoriserEvalExportArgumentError('Output path must be absolute');
  try {
    await lstat(outputPath);
    throw new CategoriserEvalExportArgumentError('Output path already exists — refusing to overwrite');
  } catch (error) {
    if (error instanceof CategoriserEvalExportArgumentError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

const executedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (executedAsScript) void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
