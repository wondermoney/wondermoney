import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));

import { addCategory, addMerchant, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Category } from '@entity/Category';
import { Transaction } from '@entity/Transaction';
import type { TransactionMerchant } from '@entity/TransactionMerchant';
import accountRoutes from '@route/account';
import ruleRoutes from '@route/rule';

/*
 * The transaction update responses carry `ruleSuggestion`: null, or the rule to offer when this
 * recategorization repeats a pattern of the member's own (three matching changes in 90 days). The
 * single and the bulk update both answer it; dismissing it through the rules API stops the offer.
 */
describe('rule suggestion in the transaction update responses', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const accounts = tenantHttp('/v1/account', accountRoutes);
  const rules = tenantHttp('/v1/rule', ruleRoutes);
  let day = 0;

  async function row(household: Household, description: string, merchant?: TransactionMerchant): Promise<Transaction> {
    const em = db.em();
    const created = await addTransaction(em, household, { amount: -25, date: new Date(`2026-10-${String(++day % 28 + 1).padStart(2, '0')}T12:00:00Z`), merchant, status: 'BOOKED' });
    created.description = description;
    await em.flush();
    return created;
  }

  async function household() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const groceries = await addCategory(em, owner, 'Groceries');
    const lidl = await addMerchant(em, owner, 'Lidl');
    const rows = await Promise.all(['COMPRA 1192 LIDL LISBOA', 'COMPRA 1192 LIDL PORTO', 'COMPRA 4589 LIDL BRAGA', 'COMPRA 1192 LIDL FARO'].map((description) => row(owner, description, lidl)));
    return { groceries, owner, rows };
  }

  const categorize = (owner: Household, transaction: Transaction, category: Category) =>
    accounts.as(owner.appuser).patch(`/v1/account/transaction/${transaction.transactionKey}`).send({ categoryKey: String(category.categoryKey) });

  it('answers null for the first two matching changes and the suggestion on the third, beside the transaction', async () => {
    const { groceries, owner, rows: [first, second, third] } = await household();

    const answers = [];
    for (const transaction of [first!, second!, third!]) answers.push(await categorize(owner, transaction, groceries));

    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
    expect(answers[0]!.body.ruleSuggestion).toBeNull();
    expect(answers[1]!.body.ruleSuggestion).toBeNull();
    expect(answers[2]!.body).toMatchObject({
      ruleSuggestion: {
        category: { categoryKey: groceries.categoryKey, name: 'Groceries' },
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        kind: 'merchant',
        matchCount: 3,
        rule: { actions: [{ categoryId: groceries.categoryKey, type: 'set_category' }], conditions: [{ field: 'merchant', operator: 'equals', value: 'Lidl' }], match: 'all', name: 'Lidl' },
        windowDays: 90,
      },
      transaction: { transactionKey: third!.transactionKey },
    });
  });

  it('answers the suggestion from a bulk recategorization, counting each row', async () => {
    const { groceries, owner, rows: [first, second, third] } = await household();

    const response = await accounts.as(owner.appuser).patch('/v1/account/transaction').send({ categoryId: String(groceries.categoryKey), transactionIds: [first!.transactionKey, second!.transactionKey, third!.transactionKey] });

    expect(response.status).toBe(200);
    expect(response.body.ruleSuggestion).toMatchObject({ kind: 'merchant', matchCount: 3 });
  });

  it('answers null from a bulk change that does not categorize', async () => {
    const { owner, rows: [first] } = await household();

    const response = await accounts.as(owner.appuser).patch('/v1/account/transaction').send({ reviewed: true, transactionIds: [first!.transactionKey] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ruleSuggestion: null });
  });

  it('does not suggest when the category did not change', async () => {
    const { groceries, owner, rows: [first, second, third] } = await household();
    for (const transaction of [first!, second!, third!]) await categorize(owner, transaction, groceries);

    const again = await categorize(owner, third!, groceries);

    expect(again.body.ruleSuggestion).toBeNull();
  });

  it('stops offering a suggestion once the member dismisses it', async () => {
    const { groceries, owner, rows: [first, second, third, fourth] } = await household();
    for (const transaction of [first!, second!]) await categorize(owner, transaction, groceries);
    const { fingerprint } = (await categorize(owner, third!, groceries)).body.ruleSuggestion as { fingerprint: string };

    const dismissed = await rules.as(owner.appuser).post('/v1/rule/suggestions/dismiss').send({ fingerprint });
    const next = await categorize(owner, fourth!, groceries);

    expect(dismissed.status).toBe(204);
    expect(next.body.ruleSuggestion?.fingerprint).not.toBe(fingerprint);
  });

  it('refuses a dismissal that is not a fingerprint', async () => {
    const { owner } = await household();

    const response = await rules.as(owner.appuser).post('/v1/rule/suggestions/dismiss').send({ fingerprint: 'not-a-fingerprint' });

    expect(response.status).toBe(400);
  });

  it('does not count transactions entered with their category as recategorizations', async () => {
    const em = db.em();
    const owner = await seedHousehold(em);
    const family = await addCategory(em, owner, 'Family');
    for (const [description, payee] of [['TRF MB WAY 912345678 ANA', 'Ana'], ['TRF MB WAY 913333333 RUI', 'Rui']]) {
      const created = await accounts.as(owner.appuser).post(`/v1/account/${owner.account.accountKey}/transaction`).send({
        categoryId: String(family.categoryKey),
        description,
        settlementAmount: -10,
        settlementCurrencyId: owner.currency.currencyKey,
        transactionDate: '2026-10-20T12:00:00Z',
        transactionMerchantName: payee,
        transactionTypeId: owner.types.cardPayment.transactionTypeKey,
      });
      expect(created.status).toBe(201);
    }
    const third = await row(owner, 'TRF MB WAY 961111111 JOAO');

    const response = await categorize(owner, third, family);

    expect(await em.count(Transaction, { description: { $like: 'TRF MB WAY%' }, tenantKey: owner.tenant }, { filters: false })).toBe(3);
    expect(response.body.ruleSuggestion).toBeNull();
  });
});
