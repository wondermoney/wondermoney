import { describe, expect, it } from 'vitest';

import { hasSensitiveBankingPattern, sanitizeCategoryLabel, sanitizeMerchantSuggestion, sanitizeTransactionEnrichmentText } from '../privacy';

describe('transaction enrichment privacy', () => {
  it('sanitizes text with per-helper max lengths', () => {
    expect(sanitizeTransactionEnrichmentText('a'.repeat(81))).toBeUndefined();
    expect(sanitizeMerchantSuggestion('a'.repeat(81))).toBeUndefined();
    expect(sanitizeCategoryLabel('a'.repeat(51))).toBeUndefined();
  });

  it('rejects pii and sensitive banking patterns', () => {
    expect(sanitizeTransactionEnrichmentText('conta')).toBeUndefined();
    expect(sanitizeTransactionEnrichmentText('cartao')).toBeUndefined();
    expect(sanitizeTransactionEnrichmentText('cartão')).toBeUndefined();
    expect(sanitizeTransactionEnrichmentText('ref: ABCD1234')).toBeUndefined();
    expect(sanitizeTransactionEnrichmentText('AB12CD34EF56GH78IJ90')).toBeUndefined();
    expect(sanitizeTransactionEnrichmentText('foo/bar;baz|qux;zed')).toBeUndefined();
    expect(sanitizeTransactionEnrichmentText('PT50 1234 5678 9012 3456 7890 1')).toBeUndefined();
    expect(sanitizeTransactionEnrichmentText('user@example.com')).toBeUndefined();
    expect(sanitizeTransactionEnrichmentText('https://example.com')).toBeUndefined();
    expect(sanitizeTransactionEnrichmentText('+351 912 345 678')).toBeUndefined();
  });

  it('keeps safe text and detects sensitive patterns', () => {
    expect(sanitizeTransactionEnrichmentText(' Café Lisboa ')).toBe('Café Lisboa');
    expect(hasSensitiveBankingPattern('IBAN PT50 1234 5678 9012 3456 7890 1')).toBe(true);
  });
});
