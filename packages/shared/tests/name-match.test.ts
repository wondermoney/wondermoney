import { describe, expect, it } from 'vitest';

import { matchByName, normalizeName, suggestCategory } from '../lib/import/name-match';

/*
 * Name matching for the mapping steps of an import: case, accents, punctuation and spacing are set
 * aside, every name a candidate goes by (stored, translated) counts, and only a single match is a
 * suggestion.
 */
describe('name matching', () => {
  it('reads names the same whatever their case, accents, punctuation and spacing', () => {
    expect(normalizeName('  Café,  Restaurants & Bars ')).toBe('cafe restaurants bars');
    expect(normalizeName('POUPANÇA')).toBe(normalizeName('poupanca'));
    expect(normalizeName('RENT_MORTGAGE')).toBe('rent mortgage');
  });

  it('matches a name to the one candidate that goes by it, in any of its names', () => {
    const candidates = [
      { id: 1, names: ['GROCERIES', 'Supermercado'] },
      { id: 2, names: ['CAFE_RESTAURANTS_BARS', 'Cafés, restaurantes e bares'] },
    ];

    expect(matchByName('supermercado', candidates)).toBe(1);
    expect(matchByName('Cafes Restaurantes e Bares', candidates)).toBe(2);
    expect(matchByName('Groceries', candidates)).toBe(1);
  });

  it('suggests nothing when no candidate matches, or when two do', () => {
    const candidates = [
      { id: 1, names: ['Holidays'] },
      { id: 2, names: ['holidays'] },
    ];

    expect(matchByName('Holidays', candidates)).toBeUndefined();
    expect(matchByName('Taxes', candidates)).toBeUndefined();
    expect(matchByName('', candidates)).toBeUndefined();
  });

  it('suggests a category by its own name first, then by its full label', () => {
    const candidates = [
      { id: 1, names: ['Groceries'] },
      { id: 2, names: ['Fun: Dining Out'] },
    ];

    expect(suggestCategory({ label: 'Everyday Expenses: Groceries', name: 'Groceries' }, candidates)).toBe(1);
    expect(suggestCategory({ label: 'Fun: Dining Out', name: 'Dining Out' }, candidates)).toBe(2);
    expect(suggestCategory({ label: 'Bills: Electricity', name: 'Electricity' }, candidates)).toBeUndefined();
  });
});
