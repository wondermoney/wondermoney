import { describe, expect, it } from 'vitest';

import { selectItems } from '../datasets';
import { type CategorizationOutcome, checkThresholds, compareMappings, computeCategorizationMetrics, computeCsvMappingMetrics, type CsvMappingOutcome } from '../metrics';

const outcome = (expected: null | string, predicted: null | string, extra: Partial<CategorizationOutcome> = {}): CategorizationOutcome => ({ calledModel: true, error: false, expected, predicted, tokens: 100, ...extra });

describe('categorization metrics', () => {
  it('scores accuracy over the categorisable items, so an abstain on one counts against it', () => {
    const metrics = computeCategorizationMetrics([
      outcome('GROCERIES', 'GROCERIES'),
      outcome('FUEL', 'FUEL'),
      outcome('FUEL', 'GROCERIES'),
      outcome('HEALTH', null),
    ]);
    expect(metrics.accuracy).toBe(0.5);
    expect(metrics.precision).toBeCloseTo(2 / 3);
    expect(metrics.abstainRate).toBe(0.25);
  });

  it('counts a category on an uncategorisable item as wrong, and staying quiet on it as right', () => {
    const metrics = computeCategorizationMetrics([
      outcome(null, null),
      outcome(null, null),
      outcome(null, 'GROCERIES'),
      outcome(null, null, { calledModel: false, tokens: 0 }),
    ]);
    expect(metrics.wrongOnUncategorisableRate).toBe(0.25);
    expect(metrics.accuracy).toBeNull();
    expect(metrics.abstainRate).toBe(0.75);
  });

  it('averages tokens over items and over the items that reached the model', () => {
    const metrics = computeCategorizationMetrics([
      outcome('FUEL', 'FUEL', { tokens: 300 }),
      outcome('FUEL', null, { tokens: 100 }),
      outcome(null, null, { calledModel: false, tokens: 0 }),
      outcome(null, null, { calledModel: false, tokens: 0 }),
    ]);
    expect(metrics.meanTokensPerItem).toBe(100);
    expect(metrics.meanTokensPerCall).toBe(200);
  });

  it('reports a failed call as an error and an abstain', () => {
    const metrics = computeCategorizationMetrics([outcome('FUEL', null, { error: true, tokens: 0 }), outcome('FUEL', 'FUEL')]);
    expect(metrics.errorRate).toBe(0.5);
    expect(metrics.abstained).toBe(1);
  });

  it('measures nothing on an empty run', () => {
    const metrics = computeCategorizationMetrics([]);
    expect([metrics.accuracy, metrics.abstainRate, metrics.wrongOnUncategorisableRate, metrics.meanTokensPerItem]).toEqual([null, null, null, null]);
  });
});

describe('CSV mapping metrics', () => {
  const csv = (exactMatch: boolean, fieldsCorrect: number, extra: Partial<CsvMappingOutcome> = {}): CsvMappingOutcome => ({ error: false, exactMatch, fieldsCorrect, fieldsTotal: 10, kind: 'account', tokens: 50, ...extra });

  it('scores the exact match rate and gives partial credit per field', () => {
    const metrics = computeCsvMappingMetrics([csv(true, 10), csv(false, 9), csv(false, 0, { error: true, tokens: 0 }), csv(true, 10)]);
    expect(metrics.exactMatchRate).toBe(0.5);
    expect(metrics.fieldAccuracy).toBe(29 / 40);
    expect(metrics.errorRate).toBe(0.25);
    expect(metrics.meanTokensPerItem).toBe(37.5);
  });

  it('treats an absent field and a null one as the same answer', () => {
    expect(compareMappings({ amount: 2, date: 0 }, { amount: 2, balance: null, date: 0 }, ['date', 'amount', 'balance'])).toEqual({ fieldsCorrect: 3, fieldsTotal: 3, mismatched: [] });
    expect(compareMappings({ amount: 2, date: 0 }, { amount: 3, date: 0 }, ['date', 'amount']).mismatched).toEqual(['amount']);
  });
});

describe('thresholds', () => {
  it('fails a metric below its minimum or above its maximum', () => {
    const results = checkThresholds('categorization.llm', { accuracy: 0.55, wrongOnUncategorisableRate: 0.2 }, { max: { wrongOnUncategorisableRate: 0.15 }, min: { accuracy: 0.6 } });
    expect(results.map((result) => [result.metric, result.passed])).toEqual([['accuracy', false], ['wrongOnUncategorisableRate', false]]);
  });

  it('passes a metric on its bound', () => {
    const results = checkThresholds('csvMapping', { errorRate: 0.1, exactMatchRate: 0.6 }, { max: { errorRate: 0.1 }, min: { exactMatchRate: 0.6 } });
    expect(results.every((result) => result.passed)).toBe(true);
  });

  it('passes a metric the run could not measure', () => {
    expect(checkThresholds('categorization.llm', { wrongOnUncategorisableRate: null }, { max: { wrongOnUncategorisableRate: 0.1 } })[0]?.passed).toBe(true);
  });

  it('fails a bound on a metric that does not exist, so a misspelt threshold cannot pass silently', () => {
    expect(checkThresholds('categorization.llm', { accuracy: 1 }, { min: { acuracy: 0.6 } })[0]?.passed).toBe(false);
  });
});

describe('selectItems', () => {
  it('spreads a limited run evenly over the set', () => {
    expect(selectItems([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([0, 3, 6]);
    expect(selectItems([0, 1, 2], 10)).toEqual([0, 1, 2]);
    expect(selectItems([0, 1, 2])).toEqual([0, 1, 2]);
  });
});
