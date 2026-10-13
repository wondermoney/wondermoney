import { describe, expect, it } from 'vitest';

import { enrichTransactionMetadata, isTransactionMetadataEnrichmentEnabled } from '../transaction-metadata-enrichment.service';

describe('transaction metadata enrichment service', () => {
  it('defaults enabled and parses falsy values', () => {
    expect(isTransactionMetadataEnrichmentEnabled(undefined)).toBe(true);
    expect(isTransactionMetadataEnrichmentEnabled('0')).toBe(false);
    expect(isTransactionMetadataEnrichmentEnabled('false')).toBe(false);
    expect(isTransactionMetadataEnrichmentEnabled('no')).toBe(false);
    expect(isTransactionMetadataEnrichmentEnabled('off')).toBe(false);
    expect(isTransactionMetadataEnrichmentEnabled('yes')).toBe(true);
  });

  it('normalizes, prefers explicit description and returns deterministic rules', () => {
    const result = enrichTransactionMetadata({
      creditDebitIndicator: 'debit',
      creditorName: '  ACME\u0000LTD  ',
      debtorName: 'PERSON',
      descriptionDirty: ' raw\ntext ',
      remittanceInformationStructured: 'structured',
      remittanceInformationUnstructured: 'unstructured',
    });

    expect(result.descriptionDirty).toBe('raw text');
    expect(result.rules).toEqual(expect.arrayContaining(['descriptionDirty:preferred']));
  });

  it('rejects generic, numeric and iban-like counterparty values', () => {
    const result = enrichTransactionMetadata({
      creditDebitIndicator: 'credit',
      creditorName: 'PT 50ABCD 1234 5678 9012 3456 7890',
      debtorName: '123 456 789 012 3',
      remittanceInformationUnstructured: 'MB WAY',
    });

    expect(result.descriptionDirty).toBeUndefined();
  });

  it('truncates description dirty safely to db length', () => {
    const result = enrichTransactionMetadata({ descriptionDirty: 'a'.repeat(300) });
    expect(result.descriptionDirty).toHaveLength(255);
  });
});
