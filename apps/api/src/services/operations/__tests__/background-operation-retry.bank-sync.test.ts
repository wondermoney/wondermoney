import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';
import { Tenant } from '@entity/Tenant';
import accountAutoSyncScheduler from '@service/account/account-auto-sync-scheduler.service';
import accountInitialSyncEnqueueService from '@service/account/account-initial-sync-enqueue.service';
import backgroundOperationService from '@service/operations/background-operation.service';
import type { OwnedProducerRuntime } from '@service/queue/owned-producer-runtime';
import { ConflictError } from '@utils/errors';

// SimpleFIN is opt-in; every provider behind the interface must retry the same way.
const PROVIDERS = ['enable_banking', 'simplefin'];

/*
 * An admin retry of a failed bank sync must put back on the queue the same job its producer
 * enqueued: same queue, same payload, same singleton key. The worker checks every field against
 * the connection and the incident, so a retry built from anything else is refused there.
 * Real database: the payload is built from the stored operation, connection and incident.
 */
describe('admin retry of a failed bank sync', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });
  beforeEach(() => vi.stubEnv('BANK_PROVIDERS', PROVIDERS.join(',')));
  afterEach(() => vi.unstubAllEnvs());

  type Sent = [queue: string, payload: unknown, options: unknown];

  function producerQueue() {
    const sent: Sent[] = [];
    const send = vi.fn((queue: string, payload: unknown, options?: unknown) => {
      sent.push([queue, payload, options]);
      return Promise.resolve(`producer-job-${sent.length}`);
    });
    return { send, sendAfter: vi.fn(), sent };
  }

  function retryRuntime() {
    const sent: Sent[] = [];
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      findJobs: vi.fn().mockResolvedValue([]),
      send: vi.fn((queue: string, payload: object, options?: object) => {
        sent.push([queue, payload, options]);
        return Promise.resolve('retry-job-1');
      }),
      sendAfter: vi.fn(),
      updateQueue: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = { boss, dispose: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(undefined) } as unknown as OwnedProducerRuntime;
    return { createRuntime: () => runtime, sent };
  }

  async function linkedConnection(household: Household, provider: string) {
    const em = db.em();
    const connection = new BankConnection();
    connection.provider = provider;
    connection.appuserKey = await em.findOneOrFail(Appuser, { appuserKey: household.appuser.appuserKey });
    connection.tenantKey = await em.findOneOrFail(Tenant, { tenantKey: household.tenant.tenantKey });
    connection.externalId = `${provider}-session-${household.appuser.appuserKey}`;
    connection.state = `${provider}-state-${household.appuser.appuserKey}`;
    connection.status = BankConnectionStatus.LINKED;
    // SimpleFIN access never expires, so it stores no end date.
    connection.accessValidUntil = provider === 'simplefin' ? undefined : new Date('2099-01-01T00:00:00Z');
    em.persist(connection);
    await em.flush();
    // The scheduler only picks a connection with an open, stale account behind it.
    await em.nativeUpdate(Account, { accountKey: household.account.accountKey }, { bankConnectionKey: connection });
    return em.findOneOrFail(BankConnection, { bankConnectionKey: connection.bankConnectionKey }, { populate: ['appuserKey', 'tenantKey'] });
  }

  async function fail(correlationId: string) {
    await expect(backgroundOperationService.markFailed(correlationId, 'provider_error', true)).resolves.toBe(true);
  }

  describe.each(PROVIDERS)('on a %s connection', (provider) => {
    it('re-enqueues the initial sync its producer enqueued', async () => {
      const household = await seedHousehold(db.em());
      const connection = await linkedConnection(household, provider);
      const producer = producerQueue();
      const { operation } = await accountInitialSyncEnqueueService.enqueue(connection, { enqueue: producer });
      await fail(operation.correlationId);

      const retry = retryRuntime();
      const result = await backgroundOperationService.retryAdminOperation(operation.correlationId, 'provider outage over', { createRuntime: retry.createRuntime });

      expect(producer.sent).toHaveLength(1);
      expect(retry.sent).toEqual(producer.sent);
      expect(result).toMatchObject({ jobId: 'retry-job-1', operation: { queueJobId: 'retry-job-1', stage: 'manual-retry:queued', status: BackgroundOperationStatus.QUEUED } });
    });

    it('re-enqueues the scheduled sync its producer enqueued', async () => {
      const household = await seedHousehold(db.em());
      const connection = await linkedConnection(household, provider);
      const producer = producerQueue();
      const scan = await accountAutoSyncScheduler.enqueueDueAccountSyncs({ scheduleRunId: 'run-1', send: producer.send });
      expect(scan).toMatchObject({ enqueued: 1, failed: 0 });
      const correlationId = `account.auto-sync.requisition:run-1:${connection.bankConnectionKey}`;
      await fail(correlationId);

      const retry = retryRuntime();
      await backgroundOperationService.retryAdminOperation(correlationId, 'provider outage over', { createRuntime: retry.createRuntime });

      expect(producer.sent).toHaveLength(1);
      expect(retry.sent).toEqual(producer.sent);
      const stored = await db.em().findOneOrFail(BackgroundOperation, { correlationId });
      expect(stored).toMatchObject({ queueJobId: 'retry-job-1', status: BackgroundOperationStatus.QUEUED });
    });
  });

  it('refuses a connection that is no longer linked and leaves nothing on the queue', async () => {
    const household = await seedHousehold(db.em());
    const connection = await linkedConnection(household, 'enable_banking');
    const { operation } = await accountInitialSyncEnqueueService.enqueue(connection, { enqueue: producerQueue() });
    await fail(operation.correlationId);
    await db.em().nativeUpdate(BankConnection, { bankConnectionKey: connection.bankConnectionKey }, { status: BankConnectionStatus.EXPIRED });

    const retry = retryRuntime();
    await expect(backgroundOperationService.retryAdminOperation(operation.correlationId, 'try again', { createRuntime: retry.createRuntime })).rejects.toBeInstanceOf(ConflictError);
    expect(retry.sent).toEqual([]);
  });

  it('refuses a connection that has since moved to another member', async () => {
    const household = await seedHousehold(db.em());
    const connection = await linkedConnection(household, 'enable_banking');
    const { operation } = await accountInitialSyncEnqueueService.enqueue(connection, { enqueue: producerQueue() });
    await fail(operation.correlationId);
    const partner = await addPartner(db.em(), household);
    await db.em().nativeUpdate(BankConnection, { bankConnectionKey: connection.bankConnectionKey }, { appuserKey: partner });

    const retry = retryRuntime();
    await expect(backgroundOperationService.retryAdminOperation(operation.correlationId, 'try again', { createRuntime: retry.createRuntime })).rejects.toBeInstanceOf(ConflictError);
    expect(retry.sent).toEqual([]);
  });
});
