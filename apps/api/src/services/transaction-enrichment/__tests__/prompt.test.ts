import { describe, expect, it } from 'vitest';

import { buildTransactionEnrichmentPrompt } from '../prompt';

describe('transaction enrichment prompt', () => {
  it('returns the full prompt contract and nulls unsafe candidate text', () => {
    const result = buildTransactionEnrichmentPrompt({ candidateText: 'MB WAY transfer', categories: [{ categoryKey: 1, label: ' Groceries ' }], direction: 'debit', promptVersion: 'v1' });
    expect(result.temperature).toBe(0);
    expect(result.inputHash).toHaveLength(64);
    expect(result.inputId).toBe(result.inputHash);
    expect(result.user).toContain('"candidateText":null');
    expect(result.user).toContain('"outputContract"');
    expect(result.user).toContain('merchant_and_category_suggested');
  });

  it('hashes sanitized payload consistently and omits unsafe fields', () => {
    const first = buildTransactionEnrichmentPrompt({ candidateText: '  ACME\u0000 ', categories: [{ categoryKey: 1, label: ' Groceries ' }], direction: 'debit', promptVersion: 'v1' });
    const second = buildTransactionEnrichmentPrompt({ candidateText: 'ACME', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit', promptVersion: 'v1' });
    expect(first.inputHash).toBe(second.inputHash);
    expect(first.system).toContain('transaction enrichment assistant');
    expect(first.user).not.toContain('tenant');
    expect(first.user).not.toContain('account');
    expect(first.user).not.toContain('balance');
    expect(first.user).not.toContain('notes');
    expect(first.user).not.toContain('raw description');
  });
});
