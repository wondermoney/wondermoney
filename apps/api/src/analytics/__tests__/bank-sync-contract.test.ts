import { describe, expect, it } from 'vitest';

import {
  buildBankSyncEvent,
  deterministicRequisitionContext,
  normalizeBankSyncError,
  parseBankSyncEvent,
} from '../bank-sync-contract';

const base = {
  attempt: 2,
  distinct_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  environment: 'development' as const,
  error_category: 'provider' as const,
  error_code: 'provider_unavailable' as const,
  final: true,
  flow: 'initial-add' as const,
  incident_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  producer: 'pgboss-initial' as const,
  requisition_context: 'reqctx.v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  result: 'failed' as const,
};

describe('bank sync analytics contract', () => {
  it('hashes requisition context without leaking the raw requisition or account IDs', () => {
    const raw = 'provider-requisition-account-123';
    const context = deterministicRequisitionContext(raw);
    expect(context).toMatch(/^reqctx\.v1:[a-f0-9]{64}$/);
    expect(context).not.toContain(raw);
    expect(JSON.stringify(buildBankSyncEvent({ ...base, requisition_context: context }))).not.toContain(raw);
  });
  it('builds the exact v1 fixture and a deterministic event id', () => {
    const first = buildBankSyncEvent(base);
    const second = buildBankSyncEvent({ ...base });
    expect(first).toEqual(second);
    expect(first).toEqual({ ...base, contract_version: 'bank-sync.v1', event_id: first.event_id });
    expect(first.event_id).toMatch(/^bank-sync\.v1:[a-f0-9]{64}$/);
  });

  it('changes the id for producer, attempt, or result', () => {
    const id = buildBankSyncEvent(base).event_id;
    expect(buildBankSyncEvent({ ...base, attempt: 3 }).event_id).not.toBe(id);
    expect(buildBankSyncEvent({ ...base, result: 'partial' }).event_id).not.toBe(id);
  });

  it.each([
    { ...base, attempt: 0 },
    { ...base, distinct_id: base.distinct_id.toUpperCase() },
    { ...base, incident_id: 'not-a-uuid' },
    { ...base, flow: 'scheduled-refresh', producer: 'pgboss-initial' },
    { ...base, raw_error: 'provider payload' },
    { ...base, account_number: '123' },
    { ...base, email: 'person@example.com' },
    { ...base, access_token: 'secret' },
    { ...base, provider_payload: {} },
    { ...base, institution_id: 'x'.repeat(129) },
    { ...base, error_code: 'unsafe value!' },
  ])('rejects malformed, mismatched, unknown, or sensitive data %#', (value) => {
    expect(() => parseBankSyncEvent({
      ...value,
      contract_version: 'bank-sync.v1',
      event_id: buildBankSyncEvent(base).event_id,
    })).toThrow();
  });

  it('normalizes errors to a closed low-cardinality vocabulary', () => {
    expect(normalizeBankSyncError({ category: 'TIMEOUT', code: 'ETIMEDOUT' })).toEqual({
      error_category: 'timeout', error_code: 'timeout',
    });
    expect(normalizeBankSyncError({ category: 'novel-provider-error', code: '123456' })).toEqual({
      error_category: 'unknown', error_code: 'unknown',
    });
  });
});
