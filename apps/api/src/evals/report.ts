/** The eval run's report: the JSON kept as an artifact and the markdown summary shown in the job. */
import type { CategorizationItemResult } from './categorization';
import type { CsvMappingItemResult } from './csv-mapping';
import type { DatasetName } from './datasets';
import { type CategorizationMetrics, type CsvMappingMetrics, round, type ThresholdResult } from './metrics';

export interface EvalReport {
  categorization?: {
    bayes: { metrics: CategorizationMetrics; results: CategorizationItemResult[] };
    dataset: string;
    llm: { byLanguage: Record<string, CategorizationMetrics>; metrics: CategorizationMetrics; results: CategorizationItemResult[] };
  };
  csvMapping?: {
    byKind: Partial<Record<'account' | 'portfolio', CsvMappingMetrics>>;
    dataset: string;
    metrics: CsvMappingMetrics;
    results: CsvMappingItemResult[];
  };
  durationMs: number;
  generatedAt: string;
  models: Partial<Record<'csvMapping' | 'enrichment', ModelInfo>>;
  options: { concurrency: number; datasets: DatasetName[]; limit: null | number };
  passed: boolean;
  schemaVersion: 1;
  thresholds: ThresholdResult[];
}

export interface ModelInfo {
  kind: string;
  model: null | string;
}

/** Every rate rounded for reading; counts stay as they are. */
export function roundMetrics<T extends object>(metrics: T): T {
  return Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, typeof value === 'number' && !Number.isInteger(value) ? round(value) : value])) as T;
}

const MAX_LISTED_MISSES = 15;

export function renderMarkdown(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`## LLM evals: ${report.passed ? 'passed' : 'FAILED'}`, '');
  const models = Object.entries(report.models).map(([feature, info]) => `${feature}: \`${info.kind}\`${info.model ? ` \`${info.model}\`` : ''}`);
  lines.push(`Models: ${models.length ? models.join(', ') : 'none'}. Items per dataset: ${report.options.limit ?? 'all'}. Took ${(report.durationMs / 1000).toFixed(1)} s.`, '');

  if (report.categorization) {
    const { bayes, llm } = report.categorization;
    lines.push(`### Categorization (\`${report.categorization.dataset}\`)`, '');
    lines.push('| Metric | LLM | Bayes |', '|---|---|---|');
    const rows: [string, keyof CategorizationMetrics, 'percent' | 'plain'][] = [
      ['Accuracy', 'accuracy', 'percent'],
      ['Precision (right when it answers)', 'precision', 'percent'],
      ['Abstain rate', 'abstainRate', 'percent'],
      ['Wrong on uncategorisable', 'wrongOnUncategorisableRate', 'percent'],
      ['Errors', 'errorRate', 'percent'],
      ['Mean tokens per item', 'meanTokensPerItem', 'plain'],
      ['Mean tokens per call', 'meanTokensPerCall', 'plain'],
      ['Items (categorisable / uncategorisable)', 'items', 'plain'],
    ];
    for (const [label, key, format] of rows) {
      const cell = (metrics: CategorizationMetrics) => key === 'items' ? `${metrics.items} (${metrics.categorisable} / ${metrics.uncategorisable})` : formatValue(metrics[key], format);
      lines.push(`| ${label} | ${cell(llm.metrics)} | ${cell(bayes.metrics)} |`);
    }
    lines.push('');
    const withheld = llm.results.filter((result) => result.textWithheld).length;
    if (withheld > 0) lines.push(`The privacy filter withheld the description of ${withheld} of ${llm.metrics.modelCalls} items sent to the model, which then saw no text.`, '');
    const languages = Object.entries(llm.byLanguage).sort(([left], [right]) => left.localeCompare(right));
    if (languages.length > 1) {
      lines.push('| Language | LLM accuracy | Wrong on uncategorisable |', '|---|---|---|');
      for (const [language, metrics] of languages) {
        lines.push(`| ${language} | ${formatValue(metrics.accuracy, 'percent')} | ${formatValue(metrics.wrongOnUncategorisableRate, 'percent')} |`);
      }
      lines.push('');
    }
    const misses = llm.results.filter((result) => result.predicted !== result.expected || result.error);
    if (misses.length > 0) {
      lines.push(`<details><summary>LLM misses (${misses.length})</summary>`, '', '| Item | Expected | Written | Suggested | Confidence |', '|---|---|---|---|---|');
      for (const miss of misses.slice(0, MAX_LISTED_MISSES)) {
        lines.push(`| ${miss.id} | ${miss.expected ?? 'abstain'} | ${miss.error ? `error: ${escapeCell(miss.errorMessage ?? '')}` : (miss.predicted ?? 'abstain')} | ${miss.suggested ?? '-'} | ${miss.confidence === undefined ? '-' : miss.confidence.toFixed(2)} |`);
      }
      if (misses.length > MAX_LISTED_MISSES) lines.push('', `${misses.length - MAX_LISTED_MISSES} more in the JSON report.`);
      lines.push('', '</details>', '');
    }
  }

  if (report.csvMapping) {
    const { byKind, metrics } = report.csvMapping;
    lines.push(`### CSV mapping (\`${report.csvMapping.dataset}\`)`, '');
    lines.push('| Metric | All | Account | Portfolio |', '|---|---|---|---|');
    const rows: [string, keyof CsvMappingMetrics, 'percent' | 'plain'][] = [
      ['Exact mapping match', 'exactMatchRate', 'percent'],
      ['Field accuracy', 'fieldAccuracy', 'percent'],
      ['Errors', 'errorRate', 'percent'],
      ['Mean tokens per item', 'meanTokensPerItem', 'plain'],
      ['Items', 'items', 'plain'],
    ];
    for (const [label, key, format] of rows) {
      const cell = (value?: CsvMappingMetrics) => (value ? formatValue(value[key], format) : '-');
      lines.push(`| ${label} | ${cell(metrics)} | ${cell(byKind.account)} | ${cell(byKind.portfolio)} |`);
    }
    lines.push('');
    const misses = report.csvMapping.results.filter((result) => !result.exactMatch);
    if (misses.length > 0) {
      lines.push(`<details><summary>Mapping misses (${misses.length})</summary>`, '', '| Item | Wrong fields |', '|---|---|');
      for (const miss of misses.slice(0, MAX_LISTED_MISSES)) lines.push(`| ${miss.id} | ${miss.error ? `error: ${escapeCell(miss.errorMessage ?? '')}` : miss.mismatched.join(', ')} |`);
      lines.push('', '</details>', '');
    }
  }

  lines.push('### Thresholds', '');
  if (report.thresholds.length === 0) lines.push('None checked.');
  else {
    lines.push('| Section | Metric | Bound | Actual | Result |', '|---|---|---|---|---|');
    for (const result of report.thresholds) {
      lines.push(`| ${result.section} | ${result.metric} | ${result.bound === 'min' ? '>=' : '<='} ${result.limit} | ${result.actual === null ? 'n/a' : String(round(result.actual))} | ${result.passed ? 'pass' : '**fail**'} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ').slice(0, 120);
}

function formatValue(value: unknown, format: 'percent' | 'plain'): string {
  if (typeof value !== 'number') return 'n/a';
  if (format === 'percent') return `${(value * 100).toFixed(1)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
