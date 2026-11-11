import { describe, expect, it } from 'vitest';

import { evaluateBayesHoldout, syntheticBayesSamples } from '../bayes-eval';

describe('bayes holdout evaluation', () => {
  it('is deterministic', () => {
    expect(syntheticBayesSamples()).toEqual(syntheticBayesSamples());
  });

  it('reports accuracy and coverage above the floor on the synthetic fixture', () => {
    const result = evaluateBayesHoldout(syntheticBayesSamples());

    expect(result.trained).toBeGreaterThanOrEqual(20);
    expect(result.evaluated).toBeGreaterThan(0);
    expect(result.accuracy).not.toBeNull();
    expect(result.accuracy ?? 0).toBeGreaterThanOrEqual(0.9);
    expect(result.coverage).toBeGreaterThanOrEqual(0.7);
    expect(result.abstained).toBe(result.evaluated - result.assigned);
    expect(result.correct).toBeLessThanOrEqual(result.assigned);
  });

  it('abstains everywhere when the training slice is too small', () => {
    const result = evaluateBayesHoldout(syntheticBayesSamples(2), { trainRatio: 0.5 });

    expect(result.trained).toBeLessThan(20);
    expect(result.assigned).toBe(0);
    expect(result.accuracy).toBeNull();
    expect(result.coverage).toBe(0);
    expect(result.abstained).toBe(result.evaluated);
  });
});
