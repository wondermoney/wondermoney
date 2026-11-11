import { pathToFileURL } from 'node:url';

import { MikroORM } from '@mikro-orm/postgresql';
import { z } from 'zod';

import { loadBayesTrainingSamples } from '@service/transaction/bayes-categorization.service';
import { type BayesEvaluationSample, evaluateBayesHoldout, syntheticBayesSamples } from '@service/transaction/bayes-eval';

/**
 * Time-ordered holdout for the local Bayes categorizer, on one household member.
 *
 * It trains on that person's older confirmed categories and scores the newest ones, the way
 * production runs: history predicts the next row. Prints how often the model is right when it
 * speaks (`accuracy`), how often it speaks (`coverage`) and how often it stays quiet
 * (`abstainRate`). `--synthetic` runs the CI fixture instead of the database.
 *
 *   pnpm eval:bayes --tenant-key 12 --viewer-appuser-key 34
 *   pnpm eval:bayes --synthetic
 */
const argsSchema = z.object({
  synthetic: z.boolean().default(false),
  tenantKey: z.number().int().positive().optional(),
  trainRatio: z.number().min(0).max(1).default(0.8),
  viewerAppuserKey: z.number().int().positive().optional(),
}).strict();

export class BayesEvalArgumentError extends Error {
  override readonly name = 'BayesEvalArgumentError';
}

export async function main(argv: readonly string[] = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const samples = args.synthetic ? syntheticBayesSamples() : await loadSamples(requireNumber(args.tenantKey, '--tenant-key'), requireNumber(args.viewerAppuserKey, '--viewer-appuser-key'));
  const result = evaluateBayesHoldout(samples, { trainRatio: args.trainRatio });
  const summary = {
    abstainRate: round(result.evaluated === 0 ? 0 : result.abstained / result.evaluated),
    accuracy: result.accuracy === null ? null : round(result.accuracy),
    assigned: result.assigned,
    correct: result.correct,
    coverage: round(result.coverage),
    evaluated: result.evaluated,
    trained: result.trained,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

export function parseArgs(argv: readonly string[]): z.infer<typeof argsSchema> {
  const values: Record<string, unknown> = { synthetic: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--synthetic') {
      values['synthetic'] = true;
      continue;
    }
    const name = argument === '--tenant-key' ? 'tenantKey' : argument === '--viewer-appuser-key' ? 'viewerAppuserKey' : argument === '--train-ratio' ? 'trainRatio' : undefined;
    if (!name) throw new BayesEvalArgumentError(`Unknown argument: ${argument ?? ''}`);
    const value = argv[index + 1];
    if (value === undefined) throw new BayesEvalArgumentError(`Missing value for ${argument}`);
    values[name] = Number(value);
    index += 1;
  }
  const parsed = argsSchema.safeParse(values);
  if (!parsed.success) throw new BayesEvalArgumentError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  if (!parsed.data.synthetic && (parsed.data.tenantKey === undefined || parsed.data.viewerAppuserKey === undefined)) {
    throw new BayesEvalArgumentError('Pass --tenant-key and --viewer-appuser-key, or --synthetic');
  }
  return parsed.data;
}

async function loadSamples(tenantKey: number, viewerAppuserKey: number): Promise<BayesEvaluationSample[]> {
  const { default: config } = await import('../../mikro-orm.config');
  const orm = await MikroORM.init({ ...config, debug: false });
  try {
    const samples = await loadBayesTrainingSamples(orm.em.fork(), { tenantKey, viewerAppuserKey });
    return samples.map((sample) => ({ ...sample, date: sample.transactionDate }));
  } finally {
    await orm.close(true);
  }
}

function requireNumber(value: number | undefined, name: string): number {
  if (value === undefined) throw new BayesEvalArgumentError(`Missing ${name}`);
  return value;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const executedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (executedAsScript) void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
