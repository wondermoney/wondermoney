/**
 * Scores for the golden-set evals, and the threshold check that fails a run. Pure: outcomes in,
 * numbers out.
 */
import type { MetricBounds } from './datasets';

/** One categorization item as a categorizer finished it. `null` means no category (an abstain). */
export interface CategorizationMetrics {
  /** Abstained items over all items. */
  abstained: number;
  abstainRate: null | number;
  /** Right answers over the items that have a right answer; an abstain on one counts against it. */
  accuracy: null | number;
  /** Items that got a category. */
  assigned: number;
  categorisable: number;
  correct: number;
  errorRate: null | number;
  errors: number;
  items: number;
  /** Tokens per model call, the prompt-and-answer size. */
  meanTokensPerCall: null | number;
  /** Tokens per item, filtered items included: the cost of categorising the set. */
  meanTokensPerItem: null | number;
  modelCalls: number;
  /** Right answers over the categorisable items that got a category: how often it is right when it speaks. */
  precision: null | number;
  totalTokens: number;
  uncategorisable: number;
  wrongOnUncategorisable: number;
  /** Uncategorisable items that got a category anyway, over all uncategorisable items. */
  wrongOnUncategorisableRate: null | number;
}

export interface CategorizationOutcome {
  /** True when the call failed or its answer was rejected; the item then counts as an abstain. */
  error: boolean;
  /** The right category, or null when the item is uncategorisable. */
  expected: null | string;
  /** The category production would write, or null. */
  predicted: null | string;
  /** Tokens spent on the item; 0 when no model was called. */
  tokens: number;
  /** True when the item reached the model; withdrawals and transfers are filtered out before it. */
  calledModel: boolean;
}

export function computeCategorizationMetrics(outcomes: readonly CategorizationOutcome[]): CategorizationMetrics {
  const categorisable = outcomes.filter((outcome) => outcome.expected !== null);
  const uncategorisable = outcomes.filter((outcome) => outcome.expected === null);
  const correct = categorisable.filter((outcome) => outcome.predicted === outcome.expected).length;
  const assignedCategorisable = categorisable.filter((outcome) => outcome.predicted !== null).length;
  const wrongOnUncategorisable = uncategorisable.filter((outcome) => outcome.predicted !== null).length;
  const abstained = outcomes.filter((outcome) => outcome.predicted === null).length;
  const errors = outcomes.filter((outcome) => outcome.error).length;
  const modelCalls = outcomes.filter((outcome) => outcome.calledModel).length;
  const totalTokens = outcomes.reduce((sum, outcome) => sum + outcome.tokens, 0);

  return {
    abstained,
    abstainRate: ratio(abstained, outcomes.length),
    accuracy: ratio(correct, categorisable.length),
    assigned: outcomes.length - abstained,
    categorisable: categorisable.length,
    correct,
    errorRate: ratio(errors, outcomes.length),
    errors,
    items: outcomes.length,
    meanTokensPerCall: ratio(totalTokens, modelCalls),
    meanTokensPerItem: ratio(totalTokens, outcomes.length),
    modelCalls,
    precision: ratio(correct, assignedCategorisable),
    totalTokens,
    uncategorisable: uncategorisable.length,
    wrongOnUncategorisable,
    wrongOnUncategorisableRate: ratio(wrongOnUncategorisable, uncategorisable.length),
  };
}

/** One CSV item as the model mapped it. `fields` compares each expected field with the answer. */
export interface CsvMappingMetrics {
  errorRate: null | number;
  errors: number;
  exactMatches: number;
  /** Items whose whole mapping matched the expected one. */
  exactMatchRate: null | number;
  /** Fields right over fields compared, across all items: partial credit for a near miss. */
  fieldAccuracy: null | number;
  items: number;
  meanTokensPerItem: null | number;
  totalTokens: number;
}

export interface CsvMappingOutcome {
  error: boolean;
  exactMatch: boolean;
  /** Fields the answer got right, out of every field the comparison covers. */
  fieldsCorrect: number;
  fieldsTotal: number;
  kind: 'account' | 'portfolio';
  tokens: number;
}

export function computeCsvMappingMetrics(outcomes: readonly CsvMappingOutcome[]): CsvMappingMetrics {
  const exactMatches = outcomes.filter((outcome) => outcome.exactMatch).length;
  const errors = outcomes.filter((outcome) => outcome.error).length;
  const fieldsCorrect = outcomes.reduce((sum, outcome) => sum + outcome.fieldsCorrect, 0);
  const fieldsTotal = outcomes.reduce((sum, outcome) => sum + outcome.fieldsTotal, 0);
  const totalTokens = outcomes.reduce((sum, outcome) => sum + outcome.tokens, 0);
  return {
    errorRate: ratio(errors, outcomes.length),
    errors,
    exactMatches,
    exactMatchRate: ratio(exactMatches, outcomes.length),
    fieldAccuracy: ratio(fieldsCorrect, fieldsTotal),
    items: outcomes.length,
    meanTokensPerItem: ratio(totalTokens, outcomes.length),
    totalTokens,
  };
}

/** Field-by-field comparison of two mappings; an absent field and a null one are the same. */
export interface ThresholdResult {
  actual: null | number;
  bound: 'max' | 'min';
  limit: number;
  metric: string;
  /** False when the metric is out of bounds. A metric the run could not measure (null) passes. */
  passed: boolean;
  section: string;
}

export function compareMappings(expected: Readonly<Record<string, unknown>>, actual: Readonly<Record<string, unknown>>, fields: readonly string[]) {
  const mismatched = fields.filter((field) => (expected[field] ?? null) !== (actual[field] ?? null));
  return { fieldsCorrect: fields.length - mismatched.length, fieldsTotal: fields.length, mismatched };
}

/**
 * Checks each metric named in `bounds` against its limit. A metric missing from `metrics` is a
 * typo in the thresholds file and fails, so a misspelt bound cannot pass silently; one that is
 * null (a `--limit` run with no uncategorisable item, say) is not measured and passes.
 */
export function checkThresholds(section: string, metrics: Readonly<Record<string, null | number>>, bounds: MetricBounds): ThresholdResult[] {
  const results: ThresholdResult[] = [];
  for (const bound of ['min', 'max'] as const) {
    for (const [metric, limit] of Object.entries(bounds[bound] ?? {})) {
      const known = Object.hasOwn(metrics, metric);
      const actual = known ? (metrics[metric] ?? null) : null;
      const passed = known && (actual === null || (bound === 'min' ? actual >= limit : actual <= limit));
      results.push({ actual, bound, limit, metric, passed, section });
    }
  }
  return results;
}

export function round(value: null | number, digits = 3): null | number {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ratio(numerator: number, denominator: number): null | number {
  return denominator === 0 ? null : numerator / denominator;
}
