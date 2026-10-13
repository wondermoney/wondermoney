import { expect, it, vi } from 'vitest';

vi.mock('@service/account/account-initial-sync-account.service', () => ({ default: {} }));
vi.mock('@service/account/account-initial-sync-transaction.service', () => ({ default: {} }));
vi.mock('@service/operations/background-operation.service', () => ({ default: {} }));
vi.mock('@app/database/di', () => ({ DI: { em: {} } }));

import { handleAccountInitialSyncJob } from '@app/jobs/account-initial-sync.worker';
import { BankSyncIncidentAttempt } from '@entity/BankSyncIncidentAttempt';
import { recordAnalyticsOutboxEvent } from '@service/analytics/analytics-outbox.service';
import { BankSyncIncidentService } from '@service/bank-sync/bank-sync-incident.service';

type AccountSyncSvc = NonNullable<InitialSyncDeps['accountInitialSyncAccountService']>;
type IncidentEm = ConstructorParameters<typeof BankSyncIncidentService>[0]['em'];
type InitialSyncDeps = NonNullable<Parameters<typeof handleAccountInitialSyncJob>[1]>;
type InitialSyncJob = Parameters<typeof handleAccountInitialSyncJob>[0];
type TransactionSyncSvc = NonNullable<InitialSyncDeps['accountInitialSyncTransactionService']>;

it('runs an initial producer through the real deterministic contract and outbox path', async () => {
  const incidents: Record<string, unknown>[] = [];
  const attempts: Record<string, unknown>[] = [];
  const outbox = vi.fn();
  const tx = {
    create: vi.fn((type: unknown, data: Record<string, unknown>) => {
      const row = Object.assign(new (type as new () => object)(), data) as Record<string, unknown>;
      (type === BankSyncIncidentAttempt ? attempts : incidents).push(row);
      return row;
    }),
    findOne: vi.fn(async (type: unknown, where: Record<string, unknown>) => {
      const rows = type === BankSyncIncidentAttempt ? attempts : incidents;
      return rows.find((row) => Object.entries(where).every(([key, value]) => key === 'incidentKey' ? row[key] === value : row[key] === value)) ?? null;
    }),
    flush: vi.fn(),
    getReference: vi.fn((_type: unknown, key: unknown): unknown => key),
    upsert: vi.fn(async (type: unknown, data: Record<string, unknown>) => {
      const row = Object.assign(new (type as new () => object)(), data) as Record<string, unknown>;
      incidents.push(row);
      return row;
    }),
  };
  const em = { findOne: tx.findOne, transactional: vi.fn(async (work: (transaction: typeof tx) => unknown) => work(tx)) };
  const service = new BankSyncIncidentService({ em: em as unknown as IncidentEm, getDatabaseNow: vi.fn().mockResolvedValue(new Date('2026-07-16T10:00:00Z')), recordOutbox: async (manager, input) => { outbox(manager, input); await recordAnalyticsOutboxEvent(manager, input); }, transitionBackgroundOperation: vi.fn() });
  const allocated = await service.allocateIncident({ appuserKey: 7, correlationId: 'account.initial-sync:12', distinctId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', environment: 'development', flow: 'initial-add', producer: 'pgboss-initial', requisitionId: 'req-12', userVisible: true });

  await expect(handleAccountInitialSyncJob({ data: { connectionId: 'req-12', correlationId: allocated.correlationId, enableBankingConnectionKey: '12', incidentId: allocated.incidentId, provider: 'enable_banking' }, id: 'job-real', retryCount: 0, retryLimit: 3 } as unknown as InitialSyncJob, {
    accountInitialSyncAccountService: { syncAccountsForRequisition: vi.fn().mockResolvedValue({ status: 'completed' }) } as unknown as AccountSyncSvc,
    accountInitialSyncTransactionService: { syncTransactionsForRequisition: vi.fn().mockResolvedValue({ status: 'completed' }) } as unknown as TransactionSyncSvc,
    backgroundOperationService: { claimJobStart: vi.fn().mockResolvedValue(true), markAttemptFailedForRetry: vi.fn().mockResolvedValue(true) },
    bankSyncIncidentService: service,
  })).resolves.toBe(true);
  expect(outbox).toHaveBeenCalledWith(tx, expect.objectContaining({
    eventName: 'bank_sync_completed',
    properties: expect.objectContaining({ contract_version: 'bank-sync.v1', event_id: expect.stringMatching(/^bank-sync\.v1:[a-f0-9]{64}$/), result: 'full_success' }),
  }));
});

it('runs a controlled initial failure through one safe deterministic outbox row', async () => {
  const incidents: Record<string, unknown>[] = [];
  const attempts: Record<string, unknown>[] = [];
  const outbox = vi.fn();
  const tx = {
    create: vi.fn((type: unknown, data: Record<string, unknown>) => { const row = Object.assign(new (type as new () => object)(), data) as Record<string, unknown>; (type === BankSyncIncidentAttempt ? attempts : incidents).push(row); return row; }),
    findOne: vi.fn(async (type: unknown, where: Record<string, unknown>) => (type === BankSyncIncidentAttempt ? attempts : incidents).find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null),
    flush: vi.fn(), getReference: vi.fn((_type: unknown, key: unknown): unknown => key),
    upsert: vi.fn(async (type: unknown, data: Record<string, unknown>) => { const row = Object.assign(new (type as new () => object)(), data) as Record<string, unknown>; incidents.push(row); return row; }),
  };
  const em = { findOne: tx.findOne, transactional: vi.fn(async (work: (transaction: typeof tx) => unknown) => work(tx)) };
  const service = new BankSyncIncidentService({ em: em as unknown as IncidentEm, getDatabaseNow: vi.fn().mockResolvedValue(new Date('2026-07-16T10:00:00Z')), recordOutbox: async (manager, input) => { outbox(manager, input); await recordAnalyticsOutboxEvent(manager, input); }, transitionBackgroundOperation: vi.fn() });
  const allocated = await service.allocateIncident({ appuserKey: 7, correlationId: 'account.initial-sync:13', distinctId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', environment: 'development', flow: 'initial-add', producer: 'pgboss-initial', requisitionId: 'raw-connection-secret', userVisible: true });
  await expect(handleAccountInitialSyncJob({ data: { connectionId: 'raw-connection-secret', correlationId: allocated.correlationId, enableBankingConnectionKey: '13', incidentId: allocated.incidentId, provider: 'enable_banking' }, id: 'job-failed', retryCount: 3, retryLimit: 3 } as unknown as InitialSyncJob, {
    accountInitialSyncAccountService: { syncAccountsForRequisition: vi.fn().mockResolvedValue({ accountsTotal: 1, institutionIds: ['safe-bank'], status: 'failed' }) } as unknown as AccountSyncSvc,
    accountInitialSyncTransactionService: { syncTransactionsForRequisition: vi.fn() } as unknown as TransactionSyncSvc,
    backgroundOperationService: { claimJobStart: vi.fn().mockResolvedValue(true), markAttemptFailedForRetry: vi.fn().mockResolvedValue(true) }, bankSyncIncidentService: service,
  })).resolves.toBe(false);
  expect(outbox).toHaveBeenCalledTimes(1);
  const event = outbox.mock.calls[0]?.[1] as { eventId: string; eventName: string; properties: Record<string, unknown> };
  expect(event).toMatchObject({ eventName: 'account_add_sync_failed', properties: expect.objectContaining({ error_code: 'account_phase_failed', result: 'failed' }) });
  expect(event.eventId).toBe(event.properties['event_id']);
  expect(tx.upsert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventId: event.eventId, properties: expect.objectContaining({ $insert_id: event.eventId, event_id: event.eventId }) }), expect.anything());
  expect(JSON.stringify(event)).not.toContain('raw-connection-secret');
});
