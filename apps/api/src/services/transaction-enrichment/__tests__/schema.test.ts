import { describe, expect, it } from 'vitest';

import { parseTransactionEnrichmentResponse, parseTransactionEnrichmentResponseJson, transactionEnrichmentReasonCodes, transactionEnrichmentResponseJsonSchema } from '../schema';

describe('transaction enrichment schema', () => {
  it('parses valid responses', () => {
    const inputId = 'a'.repeat(64);
    const parsed = parseTransactionEnrichmentResponse({ categorySuggestionKey: 1, confidence: 0.9, inputId, merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' }, inputId, [1, 2]);
    expect(parsed.merchantSuggestion).toBe('ACME');
  });

  it('rejects echo mismatch bad id and unknown fields', () => {
    const inputId = 'a'.repeat(64);
    expect(() => parseTransactionEnrichmentResponse({ categorySuggestionKey: 1, confidence: 0.9, inputId: 'b'.repeat(64), merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' }, inputId, [1])).toThrow();
    expect(() => parseTransactionEnrichmentResponse({ categorySuggestionKey: 1, confidence: 0.9, inputId: 'A'.repeat(64), merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' }, inputId, [1])).toThrow();
    expect(() => parseTransactionEnrichmentResponseJson(JSON.stringify({ categorySuggestionKey: 1, confidence: 0.9, extra: true, inputId, merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' }), inputId, [1])).toThrow();
  });

  it('rejects free form category names and validates schema constraints', () => {
    const inputId = 'a'.repeat(64);
    expect(() => parseTransactionEnrichmentResponseJson(JSON.stringify({ categoryName: 'Groceries', categorySuggestionKey: 1, confidence: 0.9, inputId, merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' }), inputId, [1])).toThrow();
    expect(transactionEnrichmentResponseJsonSchema.properties.merchantSuggestion).toMatchObject({ anyOf: [{ maxLength: 80, minLength: 2, type: 'string' }, { type: 'null' }] });
    expect(transactionEnrichmentReasonCodes).toEqual([
      'merchant_and_category_suggested',
      'merchant_suggested',
      'category_suggested',
      'ambiguous',
      'insufficient_safe_context',
      'no_suggestion',
    ]);
  });
});
