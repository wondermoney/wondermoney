/**
 * Time-ordered holdout for the local Bayes categorizer.
 *
 * The model is trained on a person's older, already-confirmed transactions and scored against
 * their newer ones — the same direction production runs in, where history predicts the next row.
 * The metrics say how often it is right when it speaks (`accuracy`), how often it speaks at all
 * (`coverage`), and how often it stays quiet (`abstainRate`). `pnpm eval:bayes` runs this against
 * a tenant; the synthetic fixture keeps it covered in CI.
 */
import {
  type BayesThresholds,
  type BayesTrainingSample,
  decideBayes,
  DEFAULT_BAYES_THRESHOLDS,
  scoreBayes,
  trainBayesModel,
} from './bayes-categorizer';

export interface BayesEvaluationOptions {
  thresholds?: BayesThresholds;
  /** Share of the rows used for training; the rest are evaluated. Defaults to 0.8. */
  trainRatio?: number;
}

export interface BayesEvaluationResult {
  abstained: number;
  /** Share of assigned rows that were right; null when it assigned nothing. */
  accuracy: null | number;
  assigned: number;
  correct: number;
  /** Share of evaluated rows that got a category. */
  coverage: number;
  evaluated: number;
  trained: number;
}

export interface BayesEvaluationSample extends BayesTrainingSample {
  /** Orders the holdout. A sample with no date sorts last. */
  date?: Date | null | string;
}

interface SyntheticCategory {
  categoryKey: number;
  merchantKey: number;
  words: readonly string[];
}

export function evaluateBayesHoldout(
  samples: readonly BayesEvaluationSample[],
  options: BayesEvaluationOptions = {},
): BayesEvaluationResult {
  const ordered = [...samples].sort((left, right) => timeOf(left.date) - timeOf(right.date));
  const split = Math.max(0, Math.min(ordered.length, Math.floor(ordered.length * clampRatio(options.trainRatio ?? 0.8))));
  const training = ordered.slice(0, split);
  const evaluation = ordered.slice(split);
  const model = trainBayesModel(training);
  const thresholds = options.thresholds ?? DEFAULT_BAYES_THRESHOLDS;

  if (!model) {
    return { abstained: evaluation.length, accuracy: null, assigned: 0, correct: 0, coverage: 0, evaluated: evaluation.length, trained: training.length };
  }

  let assigned = 0;
  let correct = 0;
  for (const sample of evaluation) {
    const decision = decideBayes(scoreBayes(model, sample), thresholds);
    if (!decision) continue;
    assigned += 1;
    if (decision.categoryKey === sample.categoryKey) correct += 1;
  }

  return {
    abstained: evaluation.length - assigned,
    accuracy: assigned === 0 ? null : correct / assigned,
    assigned,
    correct,
    coverage: evaluation.length === 0 ? 0 : assigned / evaluation.length,
    evaluated: evaluation.length,
    trained: training.length,
  };
}

const SYNTHETIC_CATEGORIES: readonly SyntheticCategory[] = [
  { categoryKey: 1, merchantKey: 101, words: ['continente', 'pingo', 'doce', 'supermarket', 'groceries'] },
  { categoryKey: 2, merchantKey: 102, words: ['galp', 'repsol', 'fuel', 'station', 'diesel'] },
  { categoryKey: 3, merchantKey: 103, words: ['cafe', 'central', 'restaurant', 'lunch', 'dinner'] },
];

/**
 * A deterministic, database-free sample for CI. Three categories with distinct merchants and
 * vocabularies, interleaved over time so the holdout's tail still contains every category, plus
 * a periodic ambiguous row (no merchant, shared text) the model should refuse to label.
 */
export function syntheticBayesSamples(perCategory = 60): BayesEvaluationSample[] {
  const samples: BayesEvaluationSample[] = [];
  let seed = 42;
  const random = (): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const start = Date.UTC(2026, 0, 1);
  const day = 86_400_000;

  for (let index = 0; index < perCategory; index += 1) {
    for (const category of SYNTHETIC_CATEGORIES) {
      const ambiguous = index % 10 === 9;
      const word = category.words[1 + Math.floor(random() * (category.words.length - 1))] ?? category.words[0];
      samples.push({
        accountKey: 1,
        amount: -(5 + Math.floor(random() * 40)),
        categoryKey: category.categoryKey,
        date: new Date(start + samples.length * day),
        description: ambiguous ? 'misc payment' : `${category.words[0]} ${word}`,
        direction: 'out',
        merchantKey: ambiguous ? null : category.merchantKey,
      });
    }
  }

  return samples;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.8;
  return Math.min(1, Math.max(0, value));
}

function timeOf(value?: Date | null | string): number {
  if (value == null) return Number.POSITIVE_INFINITY;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}
