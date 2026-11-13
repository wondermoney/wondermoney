import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ completeJson: vi.fn(), csvText: '' }));

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
// The uploaded file, without object storage.
vi.mock('@service/account/csv-upload-boundary.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@service/account/csv-upload-boundary.service')>()),
  getLimitedCsvObjectText: () => Promise.resolve(mocked.csvText),
}));
// The one seam to the provider: every model call goes through it, so no call here means no model was asked.
vi.mock('@service/ai/complete-json', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@service/ai/complete-json')>()),
  completeJson: mocked.completeJson,
}));

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Appuser } from '@entity/Appuser';
import { PortfolioImportSession, PortfolioImportSessionStatus } from '@entity/PortfolioImportSession';
import portfolioImportSessionRoutes from '@route/portfolio-import-session';

/** Column names the local heuristic reads on its own. */
const NAMED_COLUMNS_CSV = 'Date,Ticker,Type,Quantity,Price,Currency\n2026-01-05,AAPL,BUY,2,150.10,USD\n';
/** Column names nothing but the model can place. */
const UNNAMED_COLUMNS_CSV = 'Booked on,Paper,Units,Cost each\n2026-01-05,AAPL,2,150.10\n';

const MODEL_ANSWER = {
  columnMapping: { assetName: null, brokerExchange: null, currency: null, externalTransactionId: null, feeAmount: null, isin: null, quantity: 'Units', ticker: 'Paper', totalAmount: null, transactionDate: 'Booked on', transactionType: null, unitPrice: 'Cost each' },
  confidence: 0.8,
  detectedBroker: null,
  layout: { dataStartRowIndex: 1, footerMatchers: null, footerRowCount: null, headerRowIndex: 0 },
  transformations: { dateFormat: null, decimalSeparator: null, negativeAmountMeansBuy: null, quantitySignIndicatesDirection: null, thousandsSeparator: null },
  warnings: [],
};

/*
 * The suggestion tries a saved spec and the column names before any model, so it answers on a
 * server with no AI provider and for a person who hid AI. Only the last step, the model, needs
 * `csvMapping` to be allowed for this person, and only that step spends the daily allowance.
 */
describe('POST /v1/portfolio-import-sessions/:id/column-mapping/suggest without AI', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/portfolio-import-sessions', portfolioImportSessionRoutes);

  beforeEach(() => {
    mocked.completeJson.mockReset().mockResolvedValue({ object: MODEL_ANSWER, tokens: { completionTokens: 1, promptTokens: 1, totalTokens: 2 } });
    vi.stubEnv('AI_BASE_URL', '');
    vi.stubEnv('AI_MODEL', '');
    vi.stubEnv('AI_DAILY_LIMIT_CSV_MAPPING', '');
  });

  afterEach(() => vi.unstubAllEnvs());

  function withProvider() {
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('AI_MODEL', 'llama3.1');
  }

  async function seedSession(input: { aiHidden?: boolean; csv: string }): Promise<{ household: Household; importSessionId: number }> {
    mocked.csvText = input.csv;
    const household = await seedHousehold(db.em());
    if (input.aiHidden) await db.em().nativeUpdate(Appuser, { appuserKey: household.appuser.appuserKey }, { preferences: { aiHidden: true } });
    const { appuser, em, portfolio } = await seedPortfolio(db.em(), household);
    const session = em.create(PortfolioImportSession, {
      appuserKey: appuser,
      correlationId: `suggest-${household.appuser.appuserKey}-${Math.random().toString(36).slice(2)}`,
      portfolioKey: portfolio,
      s3Bucket: 'portfolio-csv',
      s3Key: 'upload.csv',
      status: PortfolioImportSessionStatus.NEEDS_COLUMN_MAPPING,
      tenantKey: household.tenant,
    }, { partial: true });
    await em.flush();
    return { household, importSessionId: session.portfolioImportSessionKey };
  }

  const suggest = (household: Household, importSessionId: number) => http.as(household.appuser).post(`/v1/portfolio-import-sessions/${importSessionId}/column-mapping/suggest`);

  it('suggests from the column names on a server with no AI provider, asking no model', async () => {
    const { household, importSessionId } = await seedSession({ csv: NAMED_COLUMNS_CSV });

    const response = await suggest(household, importSessionId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ columnMapping: { columnMapping: { currency: 'Currency', quantity: 'Quantity', ticker: 'Ticker', transactionDate: 'Date', transactionType: 'Type', unitPrice: 'Price' } }, importSessionId, mappingSource: 'local_heuristic', status: 'needs_column_mapping' });
    expect(mocked.completeJson).not.toHaveBeenCalled();
  });

  it('leaves unknown columns to the person, with no model call, on a server with no AI provider', async () => {
    const { household, importSessionId } = await seedSession({ csv: UNNAMED_COLUMNS_CSV });

    const response = await suggest(household, importSessionId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ importSessionId, mappingSource: 'disabled', warning: 'Automatic column mapping suggestion is unavailable' });
    expect(response.body.columnMapping).toBeUndefined();
    expect(mocked.completeJson).not.toHaveBeenCalled();
  });

  it('suggests from the column names for a person who hid AI, asking no model although the server has one', async () => {
    withProvider();
    const { household, importSessionId } = await seedSession({ aiHidden: true, csv: NAMED_COLUMNS_CSV });

    const response = await suggest(household, importSessionId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ mappingSource: 'local_heuristic' });
    expect(mocked.completeJson).not.toHaveBeenCalled();
  });

  it('never asks the model for a person who hid AI, and returns no AI-written mapping', async () => {
    withProvider();
    const { household, importSessionId } = await seedSession({ aiHidden: true, csv: UNNAMED_COLUMNS_CSV });

    const response = await suggest(household, importSessionId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ mappingSource: 'disabled' });
    expect(response.body.columnMapping).toBeUndefined();
    expect(mocked.completeJson).not.toHaveBeenCalled();
  });

  it('asks the model when the names do not settle it and AI is allowed, sending column names and row shapes but no cell values', async () => {
    withProvider();
    const { household, importSessionId } = await seedSession({ csv: UNNAMED_COLUMNS_CSV });

    const response = await suggest(household, importSessionId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ columnMapping: { columnMapping: { quantity: 'Units', ticker: 'Paper', transactionDate: 'Booked on', unitPrice: 'Cost each' } }, mappingSource: 'llm' });
    expect(mocked.completeJson).toHaveBeenCalledTimes(1);
    const [{ feature, user }] = mocked.completeJson.mock.calls[0] as [{ feature: string; user: string }];
    expect(feature).toBe('csvMapping');
    expect(user).toContain('Booked on');
    expect(user).not.toContain('AAPL');
    expect(user).not.toContain('150.10');
  });

  it('stops asking the model once the household has used the day\'s allowance', async () => {
    withProvider();
    vi.stubEnv('AI_DAILY_LIMIT_CSV_MAPPING', '1');
    const { household, importSessionId } = await seedSession({ csv: UNNAMED_COLUMNS_CSV });

    const first = await suggest(household, importSessionId);
    const second = await suggest(household, importSessionId);

    expect(first.body).toMatchObject({ mappingSource: 'llm' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ mappingSource: 'disabled', warning: expect.any(String) });
    expect(mocked.completeJson).toHaveBeenCalledTimes(1);
  });

  it('spends none of the allowance when the column names answer', async () => {
    withProvider();
    vi.stubEnv('AI_DAILY_LIMIT_CSV_MAPPING', '1');
    const named = await seedSession({ csv: NAMED_COLUMNS_CSV });
    expect((await suggest(named.household, named.importSessionId)).body).toMatchObject({ mappingSource: 'local_heuristic' });

    mocked.csvText = UNNAMED_COLUMNS_CSV;
    const response = await suggest(named.household, named.importSessionId);

    expect(response.body).toMatchObject({ mappingSource: 'llm' });
    expect(mocked.completeJson).toHaveBeenCalledTimes(1);
  });
});
