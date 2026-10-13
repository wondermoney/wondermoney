import Big from 'big.js';
import { describe, expect, it } from 'vitest';

import { classifyBudgetThreshold } from '../aggregation-classifier';

describe('classifyBudgetThreshold', () => {
  it.each([
    ['79.99', null],
    ['80', { claimThresholds: [80], state: 'near', threshold: 80 }],
    ['99.99', { claimThresholds: [80], state: 'near', threshold: 80 }],
    ['100', { claimThresholds: [80, 100], state: 'at_limit', threshold: 100 }],
    ['100.01', { claimThresholds: [80, 100], state: 'over', threshold: 100 }],
  ])('classifies exact decimal spend %s without floating point', (spent, expected) => {
    expect(classifyBudgetThreshold(new Big(spent), new Big(100))).toEqual(expected);
  });
});
