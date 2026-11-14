/**
 * Golden-set evals for the AI features unit tests cannot judge, because they mock the model:
 * transaction categorization and CSV column mapping.
 *
 *   pnpm --filter @wondermoney/api eval                              # every dataset
 *   pnpm --filter @wondermoney/api eval --dataset categorization --limit 20
 *
 * The model comes from the same environment the API reads (`services/ai/ai-provider.ts`):
 * `AI_BASE_URL` + `AI_MODEL` for any OpenAI-compatible server (Ollama, LM Studio...),
 * `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`, or the Azure settings. The local Bayes
 * categorizer is scored on the same items and needs no model.
 *
 * Prints the markdown summary and, with `--out <dir>`, writes `llm-evals.json` and `llm-evals.md`
 * there. Exits 1 when a metric is outside `evals/thresholds.json`, 2 on a usage or setup error.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildTransactionEnrichmentConfig } from '@app/jobs/transaction-enrichment.config';
import { type AiFeature, resolveAiRoute } from '@service/ai/ai-provider';

import { runBayesCategorization, runLlmCategorization } from './categorization';
import { runCsvMapping } from './csv-mapping';
import { DATASET_FILES, DATASET_NAMES, type DatasetName, EVALS_DIR, loadCategorizationDataset, loadCsvMappingDataset, loadThresholds, selectItems, type Thresholds } from './datasets';
import { checkThresholds, computeCategorizationMetrics, computeCsvMappingMetrics, type ThresholdResult } from './metrics';
import { type EvalReport, type ModelInfo, renderMarkdown, roundMetrics } from './report';

export interface EvalArgs {
  concurrency: number;
  datasets: DatasetName[];
  limit?: number;
  out?: string;
  thresholds: string;
}

export class EvalUsageError extends Error {
  override readonly name = 'EvalUsageError';
}

const DEFAULT_CONCURRENCY = 4;

export function parseArgs(argv: readonly string[]): EvalArgs {
  const args: EvalArgs = { concurrency: DEFAULT_CONCURRENCY, datasets: [...DATASET_NAMES], thresholds: path.join(EVALS_DIR, 'thresholds.json') };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    // `pnpm eval -- --limit 5` passes the separator through.
    if (flag === '--') continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new EvalUsageError(`Missing value for ${flag ?? ''}`);
    index += 1;
    switch (flag) {
      case '--concurrency':
        args.concurrency = positiveInteger(flag, value);
        break;
      case '--dataset':
        if (value === 'all') args.datasets = [...DATASET_NAMES];
        else if ((DATASET_NAMES as readonly string[]).includes(value)) args.datasets = [value as DatasetName];
        else throw new EvalUsageError(`Unknown dataset ${value}: use ${DATASET_NAMES.join(', ')} or all`);
        break;
      case '--limit':
        args.limit = positiveInteger(flag, value);
        break;
      case '--out':
        args.out = value;
        break;
      case '--thresholds':
        args.thresholds = value;
        break;
      default:
        throw new EvalUsageError(`Unknown argument: ${flag ?? ''}`);
    }
  }
  return args;
}

const FEATURE_OF: Record<DatasetName, AiFeature> = { categorization: 'enrichment', 'csv-mapping': 'csvMapping' };

/**
 * Runs the chosen datasets against the model `process.env` configures, as the API would, and checks
 * the thresholds (`overrides.thresholds` in place of the file, for tests). Throws `EvalUsageError`
 * when a dataset's feature has no model.
 */
export async function runEvals(args: EvalArgs, overrides: { thresholds?: Thresholds } = {}): Promise<EvalReport> {
  const startedAt = Date.now();
  const models: EvalReport['models'] = {};
  for (const dataset of args.datasets) {
    const feature = FEATURE_OF[dataset];
    const info = modelInfo(feature);
    if (!info) throw new EvalUsageError(`No model is configured for ${feature} (dataset ${dataset}). Set AI_BASE_URL and AI_MODEL, AI_PROVIDER=anthropic with ANTHROPIC_API_KEY and AI_MODEL, or the Azure settings.`);
    models[feature === 'enrichment' ? 'enrichment' : 'csvMapping'] = info;
  }

  const thresholds = overrides.thresholds ?? (await loadThresholds(args.thresholds));
  const report: EvalReport = {
    durationMs: 0,
    generatedAt: new Date(startedAt).toISOString(),
    models,
    options: { concurrency: args.concurrency, datasets: args.datasets, limit: args.limit ?? null },
    passed: true,
    schemaVersion: 1,
    thresholds: [],
  };
  const checks: ThresholdResult[] = [];

  if (args.datasets.includes('categorization')) {
    const dataset = await loadCategorizationDataset();
    const items = selectItems(dataset.items, args.limit);
    const llmResults = await runLlmCategorization(dataset, items, { concurrency: args.concurrency });
    const bayesResults = runBayesCategorization(dataset, items);
    const llmMetrics = computeCategorizationMetrics(llmResults);
    const bayesMetrics = computeCategorizationMetrics(bayesResults);
    const byLanguage = Object.fromEntries([...new Set(items.map((item) => item.language))].sort().map((language) => [language, roundMetrics(computeCategorizationMetrics(llmResults.filter((result) => result.language === language)))]));
    checks.push(...checkThresholds('categorization.llm', { ...llmMetrics }, thresholds.categorization.llm));
    checks.push(...checkThresholds('categorization.bayes', { ...bayesMetrics }, thresholds.categorization.bayes));
    report.categorization = {
      bayes: { metrics: roundMetrics(bayesMetrics), results: bayesResults },
      dataset: path.basename(DATASET_FILES.categorization, '.json'),
      llm: { byLanguage, metrics: roundMetrics(llmMetrics), results: llmResults },
    };
  }

  if (args.datasets.includes('csv-mapping')) {
    const dataset = await loadCsvMappingDataset();
    const items = selectItems(dataset.items, args.limit);
    const results = await runCsvMapping(items, { concurrency: args.concurrency });
    const metrics = computeCsvMappingMetrics(results);
    const byKind: NonNullable<EvalReport['csvMapping']>['byKind'] = {};
    for (const kind of ['account', 'portfolio'] as const) {
      const ofKind = results.filter((result) => result.kind === kind);
      if (ofKind.length > 0) byKind[kind] = roundMetrics(computeCsvMappingMetrics(ofKind));
    }
    checks.push(...checkThresholds('csvMapping', { ...metrics }, thresholds.csvMapping));
    report.csvMapping = { byKind, dataset: path.basename(DATASET_FILES['csv-mapping'], '.json'), metrics: roundMetrics(metrics), results };
  }

  report.thresholds = checks;
  report.passed = checks.every((check) => check.passed);
  report.durationMs = Date.now() - startedAt;
  return report;
}

/** The CLI: 0 when every threshold holds, 1 when one does not, 2 on a usage or setup error. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<{ exitCode: number; markdown?: string; report?: EvalReport }> {
  let args: EvalArgs;
  let report: EvalReport;
  try {
    args = parseArgs(argv);
    report = await runEvals(args);
  } catch (error) {
    if (!(error instanceof EvalUsageError)) throw error;
    console.error(error.message);
    return { exitCode: 2 };
  }
  const markdown = renderMarkdown(report);
  console.log(markdown);
  if (args.out) {
    await mkdir(args.out, { recursive: true });
    await writeFile(path.join(args.out, 'llm-evals.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(args.out, 'llm-evals.md'), markdown);
    console.log(`Report written to ${path.join(args.out, 'llm-evals.json')} and llm-evals.md`);
  }
  return { exitCode: report.passed ? 0 : 1, markdown, report };
}

/** Which provider and model a feature resolves to, without its key or address; null when it has none. */
function modelInfo(feature: AiFeature): ModelInfo | null {
  const route = resolveAiRoute(feature);
  if (route.kind === 'disabled') return null;
  // Enrichment names its model per call (`TRANSACTION_ENRICHMENT_GPT_MODEL_VERSION`, else the route's).
  if (feature === 'enrichment') return { kind: route.kind, model: buildTransactionEnrichmentConfig().modelVersion };
  return { kind: route.kind, model: route.kind === 'azure-foundry' ? null : route.model };
}

function positiveInteger(flag: string, value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new EvalUsageError(`${flag} takes a positive integer, got ${value}`);
  return Number(value);
}

const executedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (executedAsScript) {
  main().then(({ exitCode }) => {
    process.exitCode = exitCode;
  }, (error: unknown) => {
    console.error(error);
    process.exitCode = 2;
  });
}
