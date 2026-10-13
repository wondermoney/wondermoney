import { describe, expect, it } from 'vitest';

import { computeAllocationDrift, generateGuidanceText } from '../portfolio-allocation-drift';

describe('computeAllocationDrift', () => {
  it('reports zero drift when current matches target exactly', () => {
    const result = computeAllocationDrift({ Equities: 60, 'Fixed Income': 40 }, { Equities: 60, 'Fixed Income': 40 });
    expect(result).toEqual(
      expect.arrayContaining([
        { assetClass: 'Equities', currentPct: 60, driftPts: 0, targetPct: 60 },
        { assetClass: 'Fixed Income', currentPct: 40, driftPts: 0, targetPct: 40 },
      ]),
    );
  });

  it('computes positive drift for an overweight class and negative for underweight', () => {
    const result = computeAllocationDrift({ Equities: 72, 'Fixed Income': 28 }, { Equities: 60, 'Fixed Income': 40 });
    const equities = result.find((row) => row.assetClass === 'Equities');
    const fixedIncome = result.find((row) => row.assetClass === 'Fixed Income');
    expect(equities?.driftPts).toBeCloseTo(12);
    expect(fixedIncome?.driftPts).toBeCloseTo(-12);
  });

  it('treats a class present only in target as 0% current (fully underweight)', () => {
    const result = computeAllocationDrift({ Equities: 100 }, { Crypto: 20, Equities: 80 });
    const crypto = result.find((row) => row.assetClass === 'Crypto');
    expect(crypto).toEqual({ assetClass: 'Crypto', currentPct: 0, driftPts: -20, targetPct: 20 });
  });

  it('treats a class present only in current as 0% target (fully overweight, e.g. Unclassified)', () => {
    const result = computeAllocationDrift({ Equities: 90, Unclassified: 10 }, { Equities: 100 });
    const unclassified = result.find((row) => row.assetClass === 'Unclassified');
    expect(unclassified).toEqual({ assetClass: 'Unclassified', currentPct: 10, driftPts: 10, targetPct: 0 });
  });
});

describe('generateGuidanceText', () => {
  it('returns null when every class is within the on-target threshold', () => {
    const driftRows = [
      { assetClass: 'Equities', currentPct: 61, driftPts: 1, targetPct: 60 },
      { assetClass: 'Fixed Income', currentPct: 39, driftPts: -1, targetPct: 40 },
    ];
    expect(generateGuidanceText(driftRows)).toBeNull();
  });

  it('returns null when a class is overweight but nothing is significantly underweight', () => {
    const driftRows = [
      { assetClass: 'Equities', currentPct: 68, driftPts: 8, targetPct: 60 },
      { assetClass: 'Fixed Income', currentPct: 32, driftPts: -8, targetPct: 40 },
    ];
    // -8 is past the 5pt threshold, so this case DOES produce guidance — covered by the next test.
    // This test instead checks the boundary: driftPts exactly at -5 is not "significantly" underweight.
    const boundaryRows = [
      { assetClass: 'Equities', currentPct: 65, driftPts: 5, targetPct: 60 },
      { assetClass: 'Fixed Income', currentPct: 35, driftPts: -5, targetPct: 40 },
    ];
    expect(generateGuidanceText(boundaryRows)).toBeNull();
    expect(generateGuidanceText(driftRows)).not.toBeNull();
  });

  it('names a single underweight class', () => {
    const driftRows = [
      { assetClass: 'Equities', currentPct: 72, driftPts: 12, targetPct: 60 },
      { assetClass: 'Fixed Income', currentPct: 28, driftPts: -12, targetPct: 40 },
    ];
    expect(generateGuidanceText(driftRows)).toBe(
      'Directing future contributions toward Fixed Income could reduce this drift over time.',
    );
  });

  it('names up to 2 underweight classes, most underweight first', () => {
    const driftRows = [
      { assetClass: 'Equities', currentPct: 80, driftPts: 20, targetPct: 60 },
      { assetClass: 'Bonds', currentPct: 12, driftPts: -13, targetPct: 25 },
      { assetClass: 'Crypto', currentPct: 8, driftPts: -7, targetPct: 15 },
    ];
    expect(generateGuidanceText(driftRows)).toBe(
      'Directing future contributions toward Bonds and Crypto could reduce this drift over time.',
    );
  });

  it('falls back to generic phrasing when 3+ classes are significantly underweight', () => {
    const driftRows = [
      { assetClass: 'A', currentPct: 90, driftPts: 50, targetPct: 40 },
      { assetClass: 'B', currentPct: 4, driftPts: -16, targetPct: 20 },
      { assetClass: 'C', currentPct: 3, driftPts: -17, targetPct: 20 },
      { assetClass: 'D', currentPct: 3, driftPts: -17, targetPct: 20 },
    ];
    expect(generateGuidanceText(driftRows)).toBe(
      'Directing future contributions toward your underweight asset classes could reduce this drift over time.',
    );
  });
});
