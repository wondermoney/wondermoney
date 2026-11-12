import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import transactionImportRoutes from '@route/transaction-import';
import { TransactionImportService } from '@service/transaction-import/transaction-import.service';

/*
 * A staged import is its starter's alone, through the real authenticated-tenant stack: their
 * partner and another household get 404 for the session and its rows, and cannot change it.
 */
describe('transaction import sessions over HTTP', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/transaction-import-sessions', transactionImportRoutes, { enqueue: { send: () => Promise.resolve('job-1'), sendAfter: () => Promise.resolve(null) } });

  async function startedSession() {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    const neighbour = await seedHousehold(db.em());
    const service = new TransactionImportService(db.em(), {
      enqueue: { send: () => Promise.resolve('job-1'), sendAfter: () => Promise.resolve(null) },
      storage: {
        getAccountCsvBucketName: () => 'csv',
        getObjectBuffer: () => Promise.reject(new Error('NoSuchKey')),
        getObjectSize: () => Promise.resolve(undefined),
        presignAccountUpload: (accountKey) => Promise.resolve({ key: `account-${accountKey}-import-1.csv`, presignedUrl: 'https://files.example.test/upload' }),
      },
    });
    const session = await service.create({ appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey }, { accountId: household.account.accountKey, format: 'statement' });
    return { household, neighbour, partner, session };
  }

  it('shows the session to the person who started it', async () => {
    const { household, session } = await startedSession();
    const response = await http.as(household.appuser).get(`/v1/transaction-import-sessions/${session.id}`);
    expect(response.status).toBe(200);
    expect(response.body.session).toMatchObject({ id: session.id, status: 'waiting_for_upload' });
  });

  it('is not found for their partner or another household, to read or to change', async () => {
    const { neighbour, partner, session } = await startedSession();
    for (const user of [partner, neighbour.appuser]) {
      const agent = http.as(user);
      expect((await agent.get(`/v1/transaction-import-sessions/${session.id}`)).status).toBe(404);
      expect((await agent.get(`/v1/transaction-import-sessions/${session.id}?status=new`)).status).toBe(404);
      expect((await agent.patch(`/v1/transaction-import-sessions/${session.id}/rows`).send({ decision: 'skip', status: 'new' })).status).toBe(404);
      expect((await agent.post(`/v1/transaction-import-sessions/${session.id}/commit`)).status).toBe(404);
      expect((await agent.post(`/v1/transaction-import-sessions/${session.id}/cancel`)).status).toBe(404);
    }
  });

  it('keeps the name of the file the person uploaded, and shows it with the session', async () => {
    const household = await seedHousehold(db.em());
    const accountKey = household.account.accountKey;
    const agent = http.as(household.appuser);
    const created = await agent.post('/v1/transaction-import-sessions').send({ accountId: accountKey, fileName: 'Extrato de março 🏦.csv', format: 'statement', key: `account-${accountKey}-import-1.csv` });
    expect(created.status).toBe(201);
    expect(created.body.session.fileName).toBe('Extrato de março 🏦.csv');
    expect((await agent.get(`/v1/transaction-import-sessions/${created.body.session.id}`)).body.session.fileName).toBe('Extrato de março 🏦.csv');
  });

  it('cannot be started on an account of another household', async () => {
    const { household, neighbour } = await startedSession();
    const response = await http.as(household.appuser).post('/v1/transaction-import-sessions').send({ accountId: neighbour.account.accountKey, format: 'statement' });
    expect(response.status).toBe(404);
  });
});
