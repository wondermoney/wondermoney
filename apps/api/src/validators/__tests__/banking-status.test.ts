import { describe, expect, it } from 'vitest';

import { bankSyncStatusRequestSchema } from '../banking';

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
