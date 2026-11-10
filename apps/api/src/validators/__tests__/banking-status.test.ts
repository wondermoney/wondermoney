import { describe, expect, it } from 'vitest';

import { bankConnectionSyncsRequestSchema, bankSyncStatusRequestSchema } from '../banking';

describe('bank sync status request boundary', () => {
  it('accepts a canonical UUID', () => {
    expect(bankSyncStatusRequestSchema.safeParse({ params: { incidentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }).success).toBe(true);
  });

  it.each([
    'not-a-uuid',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-caaa-aaaaaaaaaaaa',
    'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/extra',
  ])('rejects noncanonical incident id %s', (incidentId) => {
    expect(bankSyncStatusRequestSchema.safeParse({ params: { incidentId } }).success).toBe(false);
  });
});

describe('bank connection sync-history request boundary', () => {
  it('accepts a positive integer connection id', () => {
    expect(bankConnectionSyncsRequestSchema.parse({ params: { connectionId: '42' } }).params.connectionId).toBe(42);
  });

  it.each(['0', '-1', '1.5', 'abc', ''])('rejects connection id %s', (connectionId) => {
    expect(bankConnectionSyncsRequestSchema.safeParse({ params: { connectionId } }).success).toBe(false);
  });
});
