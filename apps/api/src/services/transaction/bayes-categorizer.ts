/**
 * A token-free, local naive-Bayes categorizer.
 *
 * Most new transactions look like ones the person has already categorized. This module learns
 * those choices from their own history and labels a new row only when it is confident, so the
 * common case never needs a model call. It is pure: no I/O, no dependencies, no clock.
 *
 * Features are split into groups — description tokens, merchant, account, direction and a
 * log-scale amount bucket — and each group contributes one averaged log-likelihood term, so a
 * long description cannot outvote the merchant.
 */

export type BayesDirection = 'in' | 'out';

/** The inputs a prediction is made from. `amount` is signed; its magnitude picks the bucket. */
export interface BayesFeatureInput {
  accountKey?: null | number;
  amount?: null | number;
  description?: null | string;
  direction: BayesDirection;
  merchantKey?: null | number;
}

export interface BayesPrediction {
  categoryKey: number;
  /** `posterior` minus the runner-up's, so a lone leader always has a positive margin. */
  margin: number;
  posterior: number;
  runnerUpPosterior: number;
}

export interface BayesThresholds {
  /** The top category must beat the runner-up by at least this posterior margin. */
  minMargin: number;
  /** The top category's posterior must be at least this. */
  minPosterior: number;
}

export interface BayesTrainingSample extends BayesFeatureInput {
  categoryKey: number;
}

/** A trained model. Opaque to callers; build it with {@link trainBayesModel}. */
export interface BayesModel {
  categories: number[];
  categoryCounts: Map<number, number>;
  groups: Map<FeatureGroup, GroupCounts>;
  sampleCount: number;
}

interface GroupCounts {
  /** categoryKey → token → count. */
  counts: Map<number, Map<string, number>>;
  /** categoryKey → number of tokens seen in this group. */
  totals: Map<number, number>;
  /** Every distinct token in the group, for add-one smoothing. */
  vocabulary: Set<string>;
}

const FEATURE_GROUPS = ['description', 'merchant', 'account', 'direction', 'amount'] as const;

type FeatureGroup = (typeof FEATURE_GROUPS)[number];

/** Below this many labelled rows a model is too thin to trust; the pass abstains. */
export const MIN_TRAINING_SAMPLES = 20;

/** A model that has seen only one category cannot rank anything; the pass abstains. */
export const MIN_TRAINING_CATEGORIES = 2;

export const DEFAULT_BAYES_THRESHOLDS: BayesThresholds = { minMargin: 0.2, minPosterior: 0.8 };

/**
 * Split a bank description into lowercase word tokens. Pure digits are dropped: a reference
 * number identifies a payment, not what it was for, and would only add noise.
 */
export function tokenizeDescription(value?: null | string): string[] {
  if (!value) return [];
  return value
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && /\p{L}/u.test(token));
}

/**
 * A log-scale amount bucket: `0` for under 1, then the integer part of log10. It keeps a €12
 * coffee and a €14 lunch together while separating them from a €1,200 rent payment.
 */
export function amountBucket(amount?: null | number): null | string {
  if (amount == null || !Number.isFinite(amount)) return null;
  const magnitude = Math.abs(amount);
  if (magnitude < 1) return '0';
  return String(Math.min(6, Math.floor(Math.log10(magnitude))));
}

/** The tokens each feature group contributes for one transaction. */
export function featuresOf(input: BayesFeatureInput): Record<FeatureGroup, string[]> {
  const bucket = amountBucket(input.amount);
  return {
    account: input.accountKey == null ? [] : [`account:${input.accountKey}`],
    amount: bucket === null ? [] : [`amount:${bucket}`],
    description: tokenizeDescription(input.description),
    direction: [`direction:${input.direction}`],
    merchant: input.merchantKey == null ? [] : [`merchant:${input.merchantKey}`],
  };
}

/**
 * Multinomial naive Bayes with add-one smoothing, trained per feature group.
 *
 * Returns null — the caller must abstain — below {@link MIN_TRAINING_SAMPLES} labelled rows or
 * with fewer than {@link MIN_TRAINING_CATEGORIES} categories.
 */
export function trainBayesModel(samples: readonly BayesTrainingSample[]): BayesModel | null {
  if (samples.length < MIN_TRAINING_SAMPLES) return null;

  const categoryCounts = new Map<number, number>();
  for (const sample of samples) {
    categoryCounts.set(sample.categoryKey, (categoryCounts.get(sample.categoryKey) ?? 0) + 1);
  }
  if (categoryCounts.size < MIN_TRAINING_CATEGORIES) return null;

  const groups = new Map<FeatureGroup, GroupCounts>();
  for (const group of FEATURE_GROUPS) {
    groups.set(group, { counts: new Map(), totals: new Map(), vocabulary: new Set() });
  }

  for (const sample of samples) {
    const features = featuresOf(sample);
    for (const group of FEATURE_GROUPS) {
      const stats = groups.get(group);
      if (!stats) continue;
      const tokens = features[group];
      if (tokens.length === 0) continue;
      let byCategory = stats.counts.get(sample.categoryKey);
      if (!byCategory) {
        byCategory = new Map();
        stats.counts.set(sample.categoryKey, byCategory);
      }
      for (const token of tokens) {
        byCategory.set(token, (byCategory.get(token) ?? 0) + 1);
        stats.vocabulary.add(token);
        stats.totals.set(sample.categoryKey, (stats.totals.get(sample.categoryKey) ?? 0) + 1);
      }
    }
  }

  return {
    categories: [...categoryCounts.keys()].sort((left, right) => left - right),
    categoryCounts,
    groups,
    sampleCount: samples.length,
  };
}

/**
 * Rank every category by posterior, best first. Each group's log-likelihood is the mean over its
 * tokens, so the description's length never changes its weight next to the merchant.
 */
export function scoreBayes(model: BayesModel, input: BayesFeatureInput): BayesPrediction[] {
  const features = featuresOf(input);
  const categoryCount = model.categories.length;
  const scores = new Map<number, number>();

  for (const categoryKey of model.categories) {
    const prior = ((model.categoryCounts.get(categoryKey) ?? 0) + 1) / (model.sampleCount + categoryCount);
    let score = Math.log(prior);
    for (const group of FEATURE_GROUPS) {
      const stats = model.groups.get(group);
      const tokens = features[group];
      if (!stats || tokens.length === 0) continue;
      const vocabularySize = stats.vocabulary.size;
      if (vocabularySize === 0) continue;
      const total = stats.totals.get(categoryKey) ?? 0;
      const byCategory = stats.counts.get(categoryKey);
      let sum = 0;
      for (const token of tokens) {
        const count = byCategory?.get(token) ?? 0;
        sum += Math.log((count + 1) / (total + vocabularySize));
      }
      score += sum / tokens.length;
    }
    scores.set(categoryKey, score);
  }

  const highest = Math.max(...scores.values());
  let denominator = 0;
  const weights = new Map<number, number>();
  for (const [categoryKey, score] of scores) {
    const weight = Math.exp(score - highest);
    weights.set(categoryKey, weight);
    denominator += weight;
  }

  const ranked = [...weights.entries()]
    .map(([categoryKey, weight]) => ({ categoryKey, posterior: weight / denominator }))
    .sort((left, right) => right.posterior - left.posterior || left.categoryKey - right.categoryKey);

  return ranked.map((prediction, index) => {
    const runnerUpPosterior = ranked[index + 1]?.posterior ?? 0;
    return { ...prediction, margin: prediction.posterior - runnerUpPosterior, runnerUpPosterior };
  });
}

/**
 * The category to assign, or null when the model is not sure enough: both the top posterior and
 * the lead over the runner-up must clear their threshold.
 */
export function decideBayes(
  predictions: readonly BayesPrediction[],
  thresholds: BayesThresholds = DEFAULT_BAYES_THRESHOLDS,
): BayesPrediction | null {
  const top = predictions[0];
  if (!top) return null;
  if (top.posterior < thresholds.minPosterior) return null;
  if (top.margin < thresholds.minMargin) return null;
  return top;
}

/** The thresholds from the environment, falling back to the defaults on an absent or invalid value. */
export function bayesThresholds(env: Partial<Record<string, string | undefined>> = process.env): BayesThresholds {
  return {
    minMargin: unitInterval(env['TRANSACTION_BAYES_MIN_MARGIN'], DEFAULT_BAYES_THRESHOLDS.minMargin),
    minPosterior: unitInterval(env['TRANSACTION_BAYES_MIN_POSTERIOR'], DEFAULT_BAYES_THRESHOLDS.minPosterior),
  };
}

/**
 * The local pass is on unless explicitly disabled. It is not AI: it sends nothing anywhere, so it
 * runs even for a person who hid AI (`TRANSACTION_BAYES_CATEGORIZATION_ENABLED`).
 */
export function isBayesCategorizationEnabled(value = process.env['TRANSACTION_BAYES_CATEGORIZATION_ENABLED']): boolean {
  if (value === undefined || value.trim() === '') return true;
  return !/^(?:0|false|no|off)$/i.test(value.trim());
}

function unitInterval(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}
