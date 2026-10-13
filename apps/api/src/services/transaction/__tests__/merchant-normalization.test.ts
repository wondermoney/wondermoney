import { describe, expect, it } from 'vitest';

import { normalizeMerchantName } from '../merchant-normalization';

describe('normalizeMerchantName', () => {
  it('normalizes whitespace', () => {
    expect(normalizeMerchantName('  Coffee   Shop  ')).toBe('coffee shop');
  });

  it('removes accents', () => {
    expect(normalizeMerchantName('João Silva')).toBe('joao silva');
  });

  it('preserves meaningful words', () => {
    expect(normalizeMerchantName('Apple Services')).toBe('apple services');
    expect(normalizeMerchantName('Apple Store')).toBe('apple store');
  });
});
