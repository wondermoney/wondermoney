import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Account } from '@entity/Account';
import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import { TransactionImportSession } from '@entity/TransactionImportSession';
import accountRoutes from '@route/account';
import type { Enqueue } from '@service/queue/enqueue';

/*
 * The one-step import (`POST /v1/account/:accountId/transaction/import`) of a statement runs as a
 * staged session that commits itself, read the way the server decides: by the account's own bank,
 * whatever bank the request names.
 */
describe('the one-step statement import', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const sent: { data: unknown; queue: string }[] = [];
  const enqueue: Enqueue = {
    send: (queue, data) => {
      sent.push({ data, queue });
      return Promise.resolve(`job-${sent.length}`);
    },
    sendAfter: () => Promise.resolve(null),
  };
  const http = tenantHttp('/v1/account', accountRoutes, { enqueue });

  it('stages an export of a supported bank in a self-committing session read by that bank', async () => {
    const household = await seedHousehold(db.em());
    const em = db.em();
    const bank = em.create(AccountFinancialInstitution, { id: 'bcp', name: 'bcp' }, { partial: true });
    const account = await em.findOneOrFail(Account, { accountKey: household.account.accountKey });
    account.accountFinancialInstitutionKey = bank;
    await em.flush();

    const key = `account-${account.accountKey}-bcp-statement.csv`;
    const response = await http.as(household.appuser).post(`/v1/account/${account.accountKey}/transaction/import`).send({ bankName: 'Custom Bank', key });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ correlationId: expect.any(String), status: 'queued' });
    const session = await db.em().findOneOrFail(TransactionImportSession, { publicId: response.body.importId as string });
    expect(session).toMatchObject({ autoCommit: true, correlationId: response.body.correlationId, options: { bankName: 'bcp' }, s3Key: key, status: 'parsing' });
    expect(sent.at(-1)).toMatchObject({ data: { correlationId: response.body.correlationId, mode: 'parse' }, queue: 'transaction-import' });
  });

  it('keeps the name the file had on the person\'s device, and none from a client that does not send it', async () => {
    const household = await seedHousehold(db.em());
    const accountKey = household.account.accountKey;
    const agent = http.as(household.appuser);

    const named = await agent.post(`/v1/account/${accountKey}/transaction/import`).send({ fileName: 'Extrato de março 🏦.csv', key: `account-${accountKey}-generic-1.csv` });
    const unnamed = await agent.post(`/v1/account/${accountKey}/transaction/import`).send({ key: `account-${accountKey}-generic-2.csv` });

    expect([named.status, unnamed.status]).toEqual([202, 202]);
    expect((await db.em().findOneOrFail(TransactionImportSession, { publicId: named.body.importId as string })).fileName).toBe('Extrato de março 🏦.csv');
    expect((await db.em().findOneOrFail(TransactionImportSession, { publicId: unnamed.body.importId as string })).fileName).toBeNull();
  });
});
