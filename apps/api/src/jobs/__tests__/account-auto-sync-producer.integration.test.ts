import { expect, it, vi } from 'vitest';

vi.mock('@service/account/account-initial-sync-account.service', () => ({ default: {} }));
vi.mock('@service/account/account-initial-sync-transaction.service', () => ({ default: {} }));
vi.mock('@service/operations/background-operation.service', () => ({ default: {} }));
vi.mock('@service/account/account-auto-sync-scheduler.service', () => ({ default: {} }));
vi.mock('@app/database/di', () => ({ DI: { em: {} } }));

import { handleAccountAutoSyncRequisitionJob } from '@app/jobs/account-auto-sync.worker';
import { BankSyncIncidentAttempt } from '@entity/BankSyncIncidentAttempt';
import { recordAnalyticsOutboxEvent } from '@service/analytics/analytics-outbox.service';
import { BankSyncIncidentService } from '@service/bank-sync/bank-sync-incident.service';

import { pgBossJob } from '../../__tests__/__helpers__/pgboss-job';

type IncidentEm = ConstructorParameters<typeof BankSyncIncidentService>[0]['em'];
type RequisitionDeps = Parameters<typeof handleAccountAutoSyncRequisitionJob>[1];

function realIncidentHarness() {
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
  return { outbox, service, tx };
}

it.each([
  ['completed', true, 'account_sync_succeeded'],
  ['failed', false, 'bank_sync_completed'],
] as const)('runs scheduled %s through the real contract/outbox path', async (status, expected, eventName) => {
  const h = realIncidentHarness();
  const correlationId = `account.auto-sync.requisition:run-real-${status}:12`;
  const incident = await h.service.allocateIncident({ appuserKey: 7, correlationId, distinctId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', environment: 'development', flow: 'scheduled-refresh', producer: 'pgboss-scheduled', requisitionId: 'raw-connection-secret', userVisible: false });
  const run = handleAccountAutoSyncRequisitionJob(pgBossJob({ appuserKey: 7, connectionId: 'raw-connection-secret', correlationId, enableBankingConnectionKey: '12', incidentId: incident.incidentId, provider: 'enable_banking', scheduleRunId: `run-real-${status}` }, { id: `job-${status}`, retryCount: status === 'failed' ? 3 : 0, retryLimit: 3 }) as unknown as Parameters<typeof handleAccountAutoSyncRequisitionJob>[0], {
    accountService: { syncAccountsForRequisition: vi.fn().mockResolvedValue({ accountsTotal: 2, institutionIds: ['safe-bank'], status }) },
    backgroundOperationService: { claimJobStart: vi.fn().mockResolvedValue(true), markAttemptFailedForRetry: vi.fn().mockResolvedValue(true) },
    bankSyncIncidentService: h.service,
    enableBankingCredentialService: { getDecryptedCredential: vi.fn().mockResolvedValue({ applicationId: 'app-1', privateKeyPem: 'pem-1' }) },
    transactionService: { syncTransactionsForRequisition: vi.fn().mockResolvedValue({ status: 'completed' }) },
  } as unknown as RequisitionDeps);
  await expect(run).resolves.toBe(expected);
  expect(h.outbox).toHaveBeenCalledTimes(1);
  const event = h.outbox.mock.calls[0]?.[1] as { eventId: string; eventName: string; properties: Record<string, unknown> };
  expect(event.eventName).toBe(eventName);
  expect(event.eventId).toBe(event.properties['event_id']);
  expect(h.tx.upsert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventId: event.eventId, properties: expect.objectContaining({ $insert_id: event.eventId, event_id: event.eventId }) }), expect.anything());
  expect(event.properties).toMatchObject({ account_count: 2, institution_id: 'safe-bank', requisition_context: expect.stringMatching(/^reqctx\.v1:/) });
  expect(JSON.stringify(event)).not.toContain('raw-connection-secret');
});
