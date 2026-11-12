import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sanitizeTransactionEnrichmentText } from '@service/transaction-enrichment/privacy';

import { isFilteredByEligibility } from '../categorization';
import { ABSTAIN, type CategorizationDataset, type CsvMappingDataset, loadCategorizationDataset, loadCsvMappingDataset, type Thresholds } from '../datasets';
import type { EvalReport } from '../report';
import { EvalUsageError, main, parseArgs, runEvals } from '../run-evals';

import { type FakeOpenAiServer, loopbackFetch, startFakeOpenAiServer } from './fake-openai-server';
import { goldenOracle } from './golden-oracle';

function categorizationOf(report: EvalReport) {
  if (!report.categorization) throw new Error('the run scored no categorization');
  return report.categorization;
}

function csvMappingOf(report: EvalReport) {
  if (!report.csvMapping) throw new Error('the run scored no CSV mapping');
  return report.csvMapping;
}

/**
 * The whole eval, end to end, against a fake OpenAI-compatible server on 127.0.0.1 that answers
 * from the golden sets: production prompt builders, the AI SDK call, production parsers, scoring,
 * the report and the thresholds. The fake is right on every item except those in `wrong`.
 */
describe('LLM eval runner', () => {
  let categorization: CategorizationDataset;
  let csvMapping: CsvMappingDataset;
  let server: FakeOpenAiServer;
  const wrong = new Set<string>();

  const lenient: Thresholds = { categorization: { bayes: {}, llm: {} }, csvMapping: {} };
  const all = () => parseArgs([]);

  beforeAll(async () => {
    [categorization, csvMapping] = await Promise.all([loadCategorizationDataset(), loadCsvMappingDataset()]);
    server = await startFakeOpenAiServer(await goldenOracle(categorization, csvMapping, wrong));
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    wrong.clear();
    server.requests.length = 0;
    vi.stubGlobal('fetch', loopbackFetch);
    vi.stubEnv('AI_BASE_URL', server.baseURL);
    vi.stubEnv('AI_MODEL', 'fake-model');
    for (const key of ['AI_PROVIDER', 'AI_MODEL_ENRICHMENT', 'AI_MODEL_CSV_MAPPING', 'AZURE_OPENAI_API_KEY', 'AZURE_AI_FOUNDRY_API_KEY', 'TRANSACTION_ENRICHMENT_GPT_MODEL_VERSION']) vi.stubEnv(key, '');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const reachesModel = (item: CategorizationDataset['items'][number]) => !isFilteredByEligibility(item);
  const textOf = (item: CategorizationDataset['items'][number]) => sanitizeTransactionEnrichmentText(item.merchant ?? item.description);
  const visibleToModel = (item: CategorizationDataset['items'][number]) => reachesModel(item) && textOf(item) !== undefined;
  /** An item no other item shares its text with, so a mistake on it is one mistake. */
  const uniquelyVisible = (item: CategorizationDataset['items'][number]) => visibleToModel(item) && categorization.items.filter((other) => textOf(other) === textOf(item)).length === 1;

  it('scores a model that is right on everything it can see', async () => {
    const report = await runEvals(all(), { thresholds: lenient });

    const categorisable = categorization.items.filter((item) => item.expected !== ABSTAIN);
    const llm = categorizationOf(report).llm.metrics;
    expect(llm.items).toBe(categorization.items.length);
    expect(llm.modelCalls).toBe(categorization.items.filter(reachesModel).length);
    // The model can only name what the privacy filter lets it see; everything it names is right.
    expect(llm.correct).toBe(categorisable.filter(visibleToModel).length);
    expect(llm.precision).toBe(1);
    expect(llm.wrongOnUncategorisableRate).toBe(0);
    expect(llm.errorRate).toBe(0);
    expect(llm.meanTokensPerCall).toBeGreaterThan(0);

    const bayes = categorizationOf(report).bayes.metrics;
    expect(bayes.items).toBe(categorization.items.length);
    expect(bayes.modelCalls).toBe(0);
    expect(bayes.wrongOnUncategorisableRate).toBe(0);

    expect(csvMappingOf(report).metrics).toMatchObject({ errorRate: 0, exactMatchRate: 1, fieldAccuracy: 1, items: csvMapping.items.length });
    expect(server.requests).toHaveLength(llm.modelCalls + csvMapping.items.length);
    expect(report.passed).toBe(true);
  });

  it('counts each mistake against the metric it belongs to and fails the thresholds it breaks', async () => {
    const visibleCategorisable = categorization.items.filter((item) => item.expected !== ABSTAIN && uniquelyVisible(item)).slice(0, 10);
    const visibleUncategorisable = categorization.items.filter((item) => item.expected === ABSTAIN && uniquelyVisible(item)).slice(0, 6);
    const wrongCsv = [...csvMapping.items.filter((item) => item.kind === 'account').slice(0, 2), ...csvMapping.items.filter((item) => item.kind === 'portfolio').slice(0, 3)];
    for (const item of [...visibleCategorisable, ...visibleUncategorisable, ...wrongCsv]) wrong.add(item.id);
    const uncategorisable = categorization.items.filter((item) => item.expected === ABSTAIN).length;

    const report = await runEvals(all(), { thresholds: { categorization: { bayes: {}, llm: { max: { wrongOnUncategorisableRate: 0.05 } } }, csvMapping: { min: { exactMatchRate: 0.95 } } } });

    const llm = categorizationOf(report).llm.metrics;
    expect(llm.wrongOnUncategorisable).toBe(visibleUncategorisable.length);
    expect(llm.wrongOnUncategorisableRate).toBeCloseTo(visibleUncategorisable.length / uncategorisable);
    expect(llm.assigned - llm.correct - llm.wrongOnUncategorisable).toBe(visibleCategorisable.length);
    expect(csvMappingOf(report).metrics.exactMatches).toBe(csvMapping.items.length - wrongCsv.length);
    expect(csvMappingOf(report).byKind).toMatchObject({ account: { exactMatches: csvMapping.items.filter((item) => item.kind === 'account').length - 2 }, portfolio: { exactMatches: csvMapping.items.filter((item) => item.kind === 'portfolio').length - 3 } });
    expect(report.passed).toBe(false);
    expect(report.thresholds.filter((result) => !result.passed).map((result) => `${result.section}.${result.metric}`)).toEqual(['categorization.llm.wrongOnUncategorisableRate', 'csvMapping.exactMatchRate']);
  });

  it('exits 0 when the committed thresholds hold and 1 with a failing summary when they do not', async () => {
    const passing = await main(['--dataset', 'csv-mapping']);
    expect(passing.exitCode).toBe(0);
    expect(passing.markdown).toContain('LLM evals: passed');

    for (const item of csvMapping.items.slice(0, Math.ceil(csvMapping.items.length / 2))) wrong.add(item.id);
    const failing = await main(['--dataset', 'csv-mapping']);
    expect(failing.exitCode).toBe(1);
    expect(failing.markdown).toContain('LLM evals: FAILED');
    expect(failing.markdown).toMatch(/csvMapping \| exactMatchRate .*\*\*fail\*\*/);
  });

  it('runs a spread-out sample with --limit', async () => {
    const report = await runEvals(parseArgs(['--limit', '9']), { thresholds: lenient });
    expect(categorizationOf(report).llm.results.map((result) => result.language)).toEqual(expect.arrayContaining(['en', 'es', 'pt']));
    expect(categorizationOf(report).llm.metrics.items).toBe(9);
    expect(categorizationOf(report).bayes.metrics.items).toBe(9);
    expect(csvMappingOf(report).metrics.items).toBe(9);
    expect(new Set(csvMappingOf(report).results.map((result) => result.kind))).toEqual(new Set(['account', 'portfolio']));
  });

  it('records a model reply the production parser rejects as an error', async () => {
    const broken = await startFakeOpenAiServer(() => ({ categorySuggestionKey: 1, confidence: 0.9, inputId: 'not-the-input', merchantSuggestion: null, reasonCode: 'category_suggested' }));
    try {
      vi.stubEnv('AI_BASE_URL', broken.baseURL);
      const report = await runEvals(parseArgs(['--dataset', 'categorization', '--limit', '20']), { thresholds: { categorization: { bayes: {}, llm: { max: { errorRate: 0.05 } } }, csvMapping: {} } });
      const llm = categorizationOf(report).llm.metrics;
      expect(llm.errors).toBe(llm.modelCalls);
      expect(llm.assigned).toBe(0);
      expect(report.passed).toBe(false);
    } finally {
      await broken.close();
    }
  });

  it('exits 2 without a model, and on a bad argument', async () => {
    vi.stubEnv('AI_BASE_URL', '');
    expect((await main([])).exitCode).toBe(2);
    expect((await main(['--dataset', 'nope'])).exitCode).toBe(2);
    expect(() => parseArgs(['--limit', '0'])).toThrow(EvalUsageError);
    expect(() => parseArgs(['--limit'])).toThrow(EvalUsageError);
    expect(parseArgs(['--', '--dataset', 'categorization', '--limit', '5'])).toMatchObject({ datasets: ['categorization'], limit: 5 });
  });
});
