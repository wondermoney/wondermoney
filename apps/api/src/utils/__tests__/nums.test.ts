import { describe, expect, it } from 'vitest';

import { calculateMonthlyPrice, calculateTotalPrice, mult100, round } from '@utils/nums';

describe('number utils', () => {
  describe('round', () => {
    it('rounds to the provided decimal places', () => {
      expect(round('1.235', 2)).toBe('1.24');
      expect(round(2)).toBe('2.00');
    });
  });

  describe('calculateTotalPrice', () => {
    it('adds tax to the base price', () => {
      expect(calculateTotalPrice(50, 23).toString()).toBe('61.5');
    });

    it('returns the base price when tax is missing', () => {
      expect(calculateTotalPrice('50', undefined).toString()).toBe('50');
    });
  });

  describe('calculateMonthlyPrice', () => {
    it('divides price by number of months', () => {
      expect(calculateMonthlyPrice(120, 12).toString()).toBe('10');
    });
  });

  describe('mult100', () => {
    it('multiplies by 100 and returns a number', () => {
      expect(mult100(1.23)).toBeCloseTo(123);
      expect(mult100('0.5')).toBe(50);
    });
  });
});

