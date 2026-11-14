import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
// The upload link is the store's business; no request leaves the test.
vi.mock('@service/storage/s3', () => ({
  default: {
    deleteObject: () => Promise.resolve(),
    generatePresignedUrlForAccountPdf: (accountKey: number) => Promise.resolve({ key: `account-${accountKey}-statement-1.pdf`, presignedUrl: 'https://files.example.test/upload' }),
    getAccountCsvBucketName: () => 'csv',
    getObjectSize: () => Promise.resolve(undefined),
  },
}));

import { addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Appuser } from '@entity/Appuser';
import transactionImportRoutes from '@route/transaction-import';

const PATH = '/v1/transaction-import-sessions';
const VISION_MODEL = { AI_BASE_URL: 'https://api.openai.com/v1', AI_MODEL: 'gpt-4.1-mini', AI_MODEL_STATEMENT_IMPORT: 'gpt-4o' };

/*
 * Starting a PDF statement import over HTTP, through the real authenticated-tenant stack: it is
 * there only when the instance has a model for it and the person has not hidden AI, it spends the
 * household's daily allowance, it starts only on the person's own account, and the session is
 * theirs alone.
 */
describe('PDF statement imports over HTTP', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp(PATH, transactionImportRoutes, { enqueue: { send: () => Promise.resolve('job-1'), sendAfter: () => Promise.resolve(null) } });

  beforeEach(() => {
    for (const key of ['AI_PROVIDER', 'AZURE_OPENAI_API_KEY', 'AI_REQUIRES_VERIFIED_EMAIL', 'AI_DAILY_LIMIT_STATEMENT_IMPORT', 'STATEMENT_IMPORT_MAX_BYTES']) vi.stubEnv(key, '');
    for (const [key, value] of Object.entries(VISION_MODEL)) vi.stubEnv(key, value);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const start = (user: Appuser, accountId: number, body: Record<string, unknown> = {}) => http.as(user).post(`${PATH}/pdf`).send({ accountId, contentLength: 2048, fileName: 'September.pdf', ...body });

  it('starts an import waiting for its PDF, with the link to upload it to', async () => {
    const household = await seedHousehold(db.em());
    const response = await start(household.appuser, household.account.accountKey);
    expect(response.status).toBe(201);
    expect(response.body.session).toMatchObject({ fileName: 'September.pdf', format: 'pdf', statementExtraction: null, status: 'waiting_for_upload', upload: { key: `account-${household.account.accountKey}-statement-1.pdf`, url: 'https://files.example.test/upload' } });
  });

  it('is off when the instance has no model for it, even with a default model configured', async () => {
    vi.stubEnv('AI_MODEL_STATEMENT_IMPORT', '');
    const household = await seedHousehold(db.em());
    const response = await start(household.appuser, household.account.accountKey);
    expect(response.status).toBe(501);
    expect(response.body.code).toBe('feature_disabled');
  });

  it('is off for a person who hid AI', async () => {
    const household = await seedHousehold(db.em());
    await db.em().nativeUpdate(Appuser, { appuserKey: household.appuser.appuserKey }, { preferences: { aiHidden: true } });
    const response = await start(household.appuser, household.account.accountKey);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('feature_disabled');
  });

  it('spends one of the household’s daily statement imports per statement, shared with the partner', async () => {
    vi.stubEnv('AI_DAILY_LIMIT_STATEMENT_IMPORT', '2');
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    expect((await start(household.appuser, household.account.accountKey)).status).toBe(201);
    expect((await start(household.appuser, household.account.accountKey)).status).toBe(201);
    const refused = await start(partner, household.account.accountKey);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('ai_allowance_exhausted');
  });

  it('refuses a PDF over the size limit, by its code', async () => {
    vi.stubEnv('STATEMENT_IMPORT_MAX_BYTES', '1024');
    const household = await seedHousehold(db.em());
    const response = await start(household.appuser, household.account.accountKey, { contentLength: 1025 });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('statement_too_large');
  });

  it('starts only on the person’s own account, and the session is theirs alone', async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    const neighbour = await seedHousehold(db.em());
    expect((await start(household.appuser, neighbour.account.accountKey)).status).toBe(404);
    // The partner may not import into an account the owner holds.
    expect((await start(partner, household.account.accountKey)).status).toBe(404);

    const created = await start(household.appuser, household.account.accountKey);
    const id = created.body.session.id as string;
    for (const user of [partner, neighbour.appuser]) {
      const agent = http.as(user);
      expect((await agent.get(`${PATH}/${id}`)).status).toBe(404);
      expect((await agent.post(`${PATH}/${id}/parse`)).status).toBe(404);
      expect((await agent.post(`${PATH}/${id}/commit`).send({ acknowledgeMismatch: true })).status).toBe(404);
      expect((await agent.post(`${PATH}/${id}/cancel`)).status).toBe(404);
    }
    const owner = http.as(household.appuser);
    expect((await owner.get(`${PATH}/${id}`)).status).toBe(200);
    // The owner's acknowledgement is accepted as a body; the session has nothing to commit yet.
    expect((await owner.post(`${PATH}/${id}/commit`).send({ acknowledgeMismatch: true })).status).toBe(409);
    expect((await owner.post(`${PATH}/${id}/commit`).send({ acknowledge: true })).status).toBe(400);
  });

  it('does not take a PDF through the generic route, which has no AI checks', async () => {
    const household = await seedHousehold(db.em());
    const response = await http.as(household.appuser).post(PATH).send({ accountId: household.account.accountKey, format: 'pdf', key: `account-${household.account.accountKey}-statement-1.pdf` });
    expect(response.status).toBe(400);
  });
});
