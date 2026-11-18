import { expect, it, vi } from 'vitest';

import { addAccount, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Appuser } from '@entity/Appuser';
import { BankConnection, BankConnectionStatus } from '@entity/BankConnection';

import scheduler from '../account-auto-sync-scheduler.service';

const db = useTestDatabase();

it('ignores historical bank connections of deleted owners and refreshes active households', async () => {
  const deleted = await seedHousehold(db.em());
  const active = await seedHousehold(db.em());
  const em = db.em();
  const connections = [];
  for (const household of [deleted, active]) {
    const connection = em.create(BankConnection, {
      accessValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      appuserKey: household.appuser,
      externalId: `session-${household.appuser.appuserKey}`,
      provider: 'enable_banking',
      status: BankConnectionStatus.LINKED,
      tenantKey: household.tenant,
    }, { partial: true });
    const account = await addAccount(em, household);
    account.bankConnectionKey = connection;
    connections.push(connection);
  }
  // Old account deletions left linked bank records behind after anonymizing their owner.
  const deletedOwner = await em.findOneOrFail(Appuser, { appuserKey: deleted.appuser.appuserKey });
  deletedOwner.deletedAt = new Date();
  deletedOwner.recordActive = false;
  deletedOwner.externalUserId = `deleted:${deletedOwner.appuserKey}`;
  await em.flush();
  const send = vi.fn().mockResolvedValue('healthy-job');

  const result = await scheduler.enqueueDueAccountSyncs({
    backgroundOperationService: { attachQueueJob: () => Promise.resolve(true), createQueuedOperation: () => Promise.resolve(undefined) },
    scheduleRunId: 'historical-deleted-owner',
    send,
  });

  expect(result).toMatchObject({ enqueued: 1, failed: 0, total: 1 });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[1]).toMatchObject({ bankConnectionKey: String(connections[1]?.bankConnectionKey) });
});
