import { describe, expect, it } from 'vitest';

import {
  amountBucket,
  type BayesPrediction,
  bayesThresholds,
  type BayesTrainingSample,
  decideBayes,
  DEFAULT_BAYES_THRESHOLDS,
  featuresOf,
  isBayesCategorizationEnabled,
  scoreBayes,
  tokenizeDescription,
  trainBayesModel,
} from '../bayes-categorizer';

function prediction(overrides: Partial<BayesPrediction>): BayesPrediction {
  return { categoryKey: 1, margin: 0.5, posterior: 0.9, runnerUpPosterior: 0.4, ...overrides };
}

function samples(categoryKey: number, count: number, overrides: Partial<BayesTrainingSample> = {}): BayesTrainingSample[] {
  return Array.from({ length: count }, () => ({
    accountKey: 1,
    amount: -10,
    categoryKey,
    description: 'alpha beta',
    direction: 'out' as const,
    merchantKey: 1,
    ...overrides,
  }));
}

function trained(input: BayesTrainingSample[]) {
  const model = trainBayesModel(input);
  if (!model) throw new Error('expected a trained model');
  return model;
}

describe('bayes tokenizer', () => {
  it('lowercases, splits punctuation and drops single characters and pure numbers', () => {
    expect(tokenizeDescription('  Continente  PINGO-DOCE #1234 A ')).toEqual(['continente', 'pingo', 'doce']);
  });

  it('keeps accented words and handles empty input', () => {
    expect(tokenizeDescription('Café Central')).toEqual(['café', 'central']);
    expect(tokenizeDescription(undefined)).toEqual([]);
    expect(tokenizeDescription('   ')).toEqual([]);
  });
});

describe('bayes amount bucket', () => {
  it('is a log scale clamped at the top', () => {
    expect(amountBucket(0.5)).toBe('0');
    expect(amountBucket(-12)).toBe('1');
    expect(amountBucket(120)).toBe('2');
    expect(amountBucket(-1200)).toBe('3');
    expect(amountBucket(12_000)).toBe('4');
    expect(amountBucket(120_000)).toBe('5');
    expect(amountBucket(1_000_000)).toBe('6');
    expect(amountBucket(1_000_000_000)).toBe('6');
    expect(amountBucket(null)).toBeNull();
    expect(amountBucket(Number.NaN)).toBeNull();
  });
});

describe('bayes features', () => {
  it('gives every group its own token', () => {
    expect(featuresOf({ accountKey: 7, amount: -42, description: 'Continente Lisboa', direction: 'out', merchantKey: 3 })).toEqual({
      account: ['account:7'],
      amount: ['amount:1'],
      description: ['continente', 'lisboa'],
      direction: ['direction:out'],
      merchant: ['merchant:3'],
    });
  });

  it('omits groups with no value', () => {
    expect(featuresOf({ amount: null, description: null, direction: 'in' })).toEqual({
      account: [],
      amount: [],
      description: [],
      direction: ['direction:in'],
      merchant: [],
    });
  });
});

describe('bayes training', () => {
  it('abstains below the labelled-row floor', () => {
    expect(trainBayesModel(samples(1, 10).concat(samples(2, 9)))).toBeNull();
  });

  it('abstains with fewer than two categories', () => {
    expect(trainBayesModel(samples(1, 25))).toBeNull();
  });

  it('trains once there are enough rows and two categories', () => {
    const model = trainBayesModel(samples(1, 10).concat(samples(2, 10)));
    expect(model).not.toBeNull();
    expect(model?.categories).toEqual([1, 2]);
    expect(model?.sampleCount).toBe(20);
  });
});

describe('bayes scoring', () => {
  it('ranks the category whose merchant it recognizes first', () => {
    const model = trained(samples(1, 10, { merchantKey: 1 }).concat(samples(2, 10, { merchantKey: 2 })));
    const ranked = scoreBayes(model, { accountKey: 1, amount: -10, description: 'alpha beta', direction: 'out', merchantKey: 2 });
    expect(ranked[0]?.categoryKey).toBe(2);
    expect(ranked[0]?.posterior).toBeGreaterThan(0.9);
  });

  it('smooths an unseen token instead of dropping the category', () => {
    const model = trained(samples(1, 10, { merchantKey: 1 }).concat(samples(2, 10, { merchantKey: 2 })));
    const ranked = scoreBayes(model, { accountKey: 1, amount: -10, description: 'never seen before', direction: 'out', merchantKey: 1 });
    expect(ranked).toHaveLength(2);
    expect(ranked.every((entry) => Number.isFinite(entry.posterior) && entry.posterior > 0)).toBe(true);
    expect(ranked.reduce((sum, entry) => sum + entry.posterior, 0)).toBeCloseTo(1, 10);
  });

  it('does not let a long description outvote the merchant', () => {
    // The description says category 2, the merchant says category 1. Each group contributes one
    // averaged term, so they cancel and the model abstains; a summed description would flip it.
    const model = trained(samples(1, 10, { description: 'one', merchantKey: 1 }).concat(samples(2, 10, { description: 'two', merchantKey: 2 })));
    const ranked = scoreBayes(model, {
      accountKey: 1,
      amount: -10,
      description: Array.from({ length: 8 }, () => 'two').join(' '),
      direction: 'out',
      merchantKey: 1,
    });
    expect(ranked[0]?.posterior).toBeCloseTo(0.5, 6);
    expect(decideBayes(ranked)).toBeNull();
  });
});

describe('bayes decision', () => {
  it('assigns when the top posterior and the margin both clear their thresholds', () => {
    expect(decideBayes([prediction({ margin: 0.2, posterior: 0.8 })])?.categoryKey).toBe(1);
  });

  it('abstains below the posterior threshold', () => {
    expect(decideBayes([prediction({ margin: 0.3, posterior: 0.79 })])).toBeNull();
  });

  it('abstains below the margin threshold', () => {
    expect(decideBayes([prediction({ margin: 0.19, posterior: 0.95 })])).toBeNull();
  });

  it('abstains with no predictions', () => {
    expect(decideBayes([])).toBeNull();
  });
});

describe('bayes thresholds', () => {
  it('defaults to 0.8 posterior and 0.2 margin', () => {
    expect(bayesThresholds({})).toEqual(DEFAULT_BAYES_THRESHOLDS);
  });

  it('reads the environment overrides', () => {
    expect(bayesThresholds({ TRANSACTION_BAYES_MIN_MARGIN: '0.05', TRANSACTION_BAYES_MIN_POSTERIOR: '0.9' })).toEqual({ minMargin: 0.05, minPosterior: 0.9 });
  });

  it('falls back on an invalid value', () => {
    expect(bayesThresholds({ TRANSACTION_BAYES_MIN_MARGIN: '2', TRANSACTION_BAYES_MIN_POSTERIOR: 'high' })).toEqual(DEFAULT_BAYES_THRESHOLDS);
  });
});

describe('bayes switch', () => {
  it('is on by default and off only when explicitly disabled', () => {
    expect(isBayesCategorizationEnabled(undefined)).toBe(true);
    expect(isBayesCategorizationEnabled('')).toBe(true);
    expect(isBayesCategorizationEnabled('true')).toBe(true);
    expect(isBayesCategorizationEnabled('0')).toBe(false);
    expect(isBayesCategorizationEnabled('false')).toBe(false);
    expect(isBayesCategorizationEnabled('off')).toBe(false);
  });
});
