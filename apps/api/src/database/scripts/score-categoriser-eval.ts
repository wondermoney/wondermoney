import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

/**
 * Scores a blind-labelled sample (see export-categoriser-eval-sample.ts and
 * categoriser-eval-page.html) into a precision-by-confidence-bucket table, in the
 * same shape as the original RAD-444 evaluation: precision on inputs the labeller
 * judged as actually derivable (i.e. excluding rows they marked "not enough
 * information"), bucketed by the model's reported confidence.
 *
 * Usage: node --import=tsx src/database/scripts/score-categoriser-eval.ts \
 *   --sample-path <path to export-categoriser-eval-sample.ts output> \
 *   --labels-path <path to categoriser-eval-page.html's exported labels.json>
 */
const argsSchema = z.object({ labelsPath: z.string(), samplePath: z.string() }).strict();

const sampleRowSchema = z.object({
  confidence: z.coerce.number(),
  suggestedCategoryKey: z.number(),
  suggestedCategoryName: z.string(),
  transactionEnrichmentKey: z.number(),
}).passthrough();

const sampleSchema = z.object({
  categories: z.array(z.object({ categoryKey: z.number(), name: z.string() })),
  rows: z.array(sampleRowSchema),
}).passthrough();

const labelEntrySchema = z.object({
  coldPick: z.string().nullable(),
  finalPick: z.string().nullable(),
  insufficient: z.boolean(),
  revised: z.boolean(),
}).passthrough();

const labelsFileSchema = z.object({ labels: z.record(z.string(), labelEntrySchema) }).passthrough();

export class CategoriserEvalScoreArgumentError extends Error {
  override readonly name = 'CategoriserEvalScoreArgumentError';
}

export function parseArgs(argv: readonly string[]) {
  const values: Record<string, string | undefined> = {};
  const names = new Map([['--labels-path', 'labelsPath'], ['--sample-path', 'samplePath']]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const name = argument ? names.get(argument) : undefined;
    if (!name) throw new CategoriserEvalScoreArgumentError(`Unknown argument: ${argument ?? ''}`);
    const value = argv[index + 1];
    if (value === undefined) throw new CategoriserEvalScoreArgumentError(`Missing value for ${argument}`);
    values[name] = value;
    index += 1;
  }
  const parsed = argsSchema.safeParse(values);
  if (!parsed.success) throw new CategoriserEvalScoreArgumentError(parsed.error.issues.map((issue) => issue.message).join('; '));
  return parsed.data;
}

const BUCKETS = [
  { label: '0.60', max: 0.65, min: 0.6 },
  { label: '0.65', max: 0.7, min: 0.65 },
  { label: '0.70', max: 0.75, min: 0.7 },
  { label: '0.75', max: 0.85, min: 0.75 },
  { label: '0.85', max: 0.95, min: 0.85 },
  { label: '0.95', max: 1.01, min: 0.95 },
] as const;

export async function main(argv: readonly string[] = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const sample = sampleSchema.parse(JSON.parse(await readFile(args.samplePath, 'utf8')));
  const labelsFile = labelsFileSchema.parse(JSON.parse(await readFile(args.labelsPath, 'utf8')));

  const buckets = BUCKETS.map((bucket) => {
    const rowsInBucket = sample.rows.filter((row) => row.confidence >= bucket.min && row.confidence < bucket.max);
    interface JudgedEntry { label: z.infer<typeof labelEntrySchema>; row: (typeof rowsInBucket)[number] }
    const judged = rowsInBucket
      .map((row) => ({ label: labelsFile.labels[String(row.transactionEnrichmentKey)], row }))
      .filter((entry): entry is JudgedEntry => entry.label !== undefined);
    const derivable = judged.filter((entry) => !entry.label.insufficient);
    const correct = derivable.filter((entry) => entry.label.finalPick === String(entry.row.suggestedCategoryKey));
    const precision = derivable.length > 0 ? correct.length / derivable.length : null;
    return {
      bucket: bucket.label,
      correct: correct.length,
      derivable: derivable.length,
      labelled: judged.length,
      precision,
      sampled: rowsInBucket.length,
    };
  });

  const totalDerivable = buckets.reduce((sum, bucket) => sum + bucket.derivable, 0);
  const totalCorrect = buckets.reduce((sum, bucket) => sum + bucket.correct, 0);
  const totalLabelled = buckets.reduce((sum, bucket) => sum + bucket.labelled, 0);
  const totalSampled = buckets.reduce((sum, bucket) => sum + bucket.sampled, 0);

  const result = {
    buckets: buckets.map((bucket) => ({ ...bucket, precisionPct: bucket.precision === null ? null : Math.round(bucket.precision * 1000) / 10 })),
    overall: { correct: totalCorrect, derivable: totalDerivable, labelled: totalLabelled, sampled: totalSampled },
  };
  console.log(JSON.stringify(result, null, 2));
  if (totalLabelled < totalSampled) {
    console.error(`Note: ${totalSampled - totalLabelled} sampled rows have no label yet — labelling isn't complete.`);
  }
  return result;
}

const executedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (executedAsScript) void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
