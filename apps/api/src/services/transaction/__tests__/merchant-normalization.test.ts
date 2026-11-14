import { describe, expect, it } from 'vitest';

import { normalizeMerchantForMatch, normalizeMerchantName } from '../merchant-normalization';

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

describe('normalizeMerchantForMatch', () => {
  it.each([
    ['case and repeated whitespace', '  CAFE   CENTRAL  ', 'cafe central'],
    ['an apostrophe', "McDonald's", 'mcdonalds'],
    ['a hyphen', '7-Eleven', '7 eleven'],
    ['a Square processor prefix', 'SQ *CAFE CENTRAL', 'cafe central'],
    ['a Toast processor prefix', 'TST* PIZZA PLACE', 'pizza place'],
    ['a PayPal processor prefix', 'PAYPAL *SPOTIFY', 'spotify'],
    ['a Stripe processor prefix', 'STRIPE CAFE CENTRAL', 'cafe central'],
    ['a trailing city', 'CAFE CENTRAL LISBOA', 'cafe central'],
    ['a trailing country code', 'CAFE CENTRAL PT', 'cafe central'],
    ['a trailing store code', 'CAFE CENTRAL US*2H4', 'cafe central'],
    ['the AMZN Mktp abbreviation', 'AMZN Mktp US', 'amazon'],
    ['the Amazon marketplace name', 'Amazon Marketplace', 'amazon'],
    ['accents', 'João Silva', 'joao silva'],
    ['meaningful words', 'Apple Services', 'apple services'],
  ])('normalizes %s', (_label, input, expected) => {
    expect(normalizeMerchantForMatch(input)).toBe(expected);
  });

  it('keeps a merchant name that is only a location', () => {
    expect(normalizeMerchantForMatch('Lisboa')).toBe('lisboa');
  });
});
