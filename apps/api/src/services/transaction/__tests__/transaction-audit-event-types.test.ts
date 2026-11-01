import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';

import { TransactionAuditService } from '../transaction-audit.service';

/*
 * The schema is built by the real migrations, so a database constraint that rejects an event the
 * code writes shows up here: the audit write is best-effort and would otherwise fail silently.
 */
describe('transaction audit log', () => {
  const db = useTestDatabase({ schema: 'migrations' });

  it.each(Object.values(TransactionAuditEventType))('stores a %s event', async (eventType) => {
    const em = db.em();
    const household = await seedHousehold(em);
    const transaction = em.create(Transaction, {
      accountKey: household.account,
      settlementAmount: -3.5,
      settlementCurrencyKey: household.currency,
      tenantKey: household.tenant,
      transactionDate: new Date('2026-07-05T00:00:00Z'),
      transactionTypeKey: household.types.cardPayment,
    }, { partial: true });
    await em.flush();

    await TransactionAuditService.log(em, {
      accountKey: household.account.accountKey,
      actorType: TransactionAuditActorType.SYSTEM,
      appuserKey: household.appuser.appuserKey,
      eventType,
      source: 'test',
      tenantKey: household.tenant.tenantKey,
      transactionKey: transaction.transactionKey,
    });

    expect(await db.em().count(TransactionAuditLog, { eventType }, { filters: false })).toBe(1);
  });
});
