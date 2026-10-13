import type { PgBoss } from 'pg-boss';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

const { em } = vi.hoisted(() => ({ em: { findOne: vi.fn() } }));
const completeIncident = vi.hoisted(() => vi.fn().mockResolvedValue({ incidentId: 'incident-recovered' }));
vi.mock('@app/database/di', () => ({ DI: { em } }));
vi.mock('@service/bank-sync/bank-sync-incident.service', () => ({ BankSyncIncidentService: class { completeOrAllocateLegacyIncident = completeIncident; } }));

import type { OwnedProducerRuntime } from '@service/queue/owned-producer-runtime';
import type { RecoveryTransport } from '@service/queue/recovery-transport';
import { ConflictError } from '@utils/errors';

import { getBackgroundOperationRetrySpec } from '../background-operation-retry-registry';

describe('background operation retry registry', () => {
  it('accepts real and owned pg-boss transports', () => {
    expectTypeOf<PgBoss>().toExtend<RecoveryTransport>();
    expectTypeOf<OwnedProducerRuntime['boss']>().toExtend<RecoveryTransport>();
  });

  it('builds foundation payload', async () => {
    const spec = getBackgroundOperationRetrySpec('foundation.health-check');
    if (!spec) throw new Error('missing spec');
    await expect(spec.buildPayload({ correlationId: 'cid', operationType: 'foundation.health-check', resourceId: '' })).resolves.toEqual({ correlationId: 'cid' });
  });

  it('builds account payload', async () => {
    em.findOne.mockResolvedValueOnce({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, sessionId: 'req-1', state: 'state-1', status: 'linked' });
    const spec = getBackgroundOperationRetrySpec('account.initial-sync');
    if (!spec) throw new Error('missing spec');
    await expect(spec.buildPayload({ correlationId: 'cid', operationType: 'account.initial-sync', resourceId: 'enable-banking-connection:12' })).resolves.toEqual({ connectionId: 'req-1', correlationId: 'cid', enableBankingConnectionKey: '12', incidentId: 'incident-recovered', provider: 'enable_banking' });
  });

  it('builds account auto sync payload', async () => {
    em.findOne.mockResolvedValueOnce({ appuserKey: { appuserKey: 7, externalUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, sessionId: 'req-2', state: 'state-2', status: 'linked' });
    const spec = getBackgroundOperationRetrySpec('account.auto-sync.requisition');
    if (!spec) throw new Error('missing spec');
    await expect(spec.buildPayload({ correlationId: 'account.auto-sync.requisition:run-1:12', operationType: 'account.auto-sync.requisition', resourceId: 'enable-banking-connection:12' })).resolves.toEqual({ connectionId: 'req-2', correlationId: 'account.auto-sync.requisition:run-1:12', enableBankingConnectionKey: '12', incidentId: 'incident-recovered', provider: 'enable_banking', scheduleRunId: 'run-1' });
  });

  it('builds account auto sync schedule payload', async () => {
    const spec = getBackgroundOperationRetrySpec('account.auto-sync.schedule');
    if (!spec) throw new Error('missing spec');
    await expect(spec.buildPayload({ correlationId: 'schedule-cid', operationType: 'account.auto-sync.schedule', resourceId: 'account-auto-sync:scheduled-scan' })).resolves.toEqual({ correlationId: 'schedule-cid' });
  });

  it('uses connection singleton for account auto sync retries', async () => {
    const spec = getBackgroundOperationRetrySpec('account.auto-sync.requisition');
    if (!spec?.buildSingletonKey) throw new Error('missing singleton builder');
    await expect(spec.buildSingletonKey({ correlationId: 'cid', operationType: 'account.auto-sync.requisition', resourceId: 'enable-banking-connection:12' })).resolves.toBe('account.auto-sync.connection:12');
  });

  it('rejects malformed resource ids', async () => {
    const spec = getBackgroundOperationRetrySpec('account.initial-sync');
    if (!spec) throw new Error('missing spec');
    await expect(spec.buildPayload({ correlationId: 'cid', operationType: 'account.initial-sync', resourceId: 'bad' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects missing or unlinked requisitions', async () => {
    const spec = getBackgroundOperationRetrySpec('account.initial-sync');
    em.findOne.mockResolvedValueOnce(null);
    if (!spec) throw new Error('missing spec');
    await expect(spec.buildPayload({ correlationId: 'cid', operationType: 'account.initial-sync', resourceId: 'enable-banking-connection:12' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects unlinked requisitions', async () => {
    const spec = getBackgroundOperationRetrySpec('account.initial-sync');
    em.findOne.mockResolvedValueOnce({ sessionId: 'req-1', state: 'state-1', status: 'created' });
    if (!spec) throw new Error('missing spec');
    await expect(spec.buildPayload({ correlationId: 'cid', operationType: 'account.initial-sync', resourceId: 'enable-banking-connection:12' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('returns null for unsupported operation types', () => {
    expect(getBackgroundOperationRetrySpec('unknown.type')).toBeNull();
  });

  it('builds account csv import payload', async () => {
    const spec = getBackgroundOperationRetrySpec('account.csv-import');
    if (!spec) throw new Error('missing spec');
    await expect(spec.buildPayload({ correlationId: 'cid', operationType: 'account.csv-import', resourceId: 'account-csv-import:12:bcp:bucket:key.csv' })).resolves.toEqual({ accountKey: 12, bankName: 'bcp', bucket: 'bucket', correlationId: 'cid', key: 'key.csv' });
  });

  it('builds asset price refresh payload and singleton key', async () => {
    const spec = getBackgroundOperationRetrySpec('asset-price.refresh');
    if (!spec) throw new Error('missing spec');
    await expect(spec.buildPayload({ correlationId: 'cid', operationType: 'asset-price.refresh' })).resolves.toEqual({ correlationId: 'cid' });
    if (!spec.buildSingletonKey) throw new Error('missing singleton builder');
    await expect(spec.buildSingletonKey({ correlationId: 'cid', operationType: 'asset-price.refresh' })).resolves.toBe('asset-price.refresh');
  });

});
