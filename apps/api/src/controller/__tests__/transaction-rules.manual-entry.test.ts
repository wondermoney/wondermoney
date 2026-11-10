import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, addCategory, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import type { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Rule, RuleMatchMode } from '@entity/Rule';
import { Transaction } from '@entity/Transaction';
import accountRoutes from '@route/account';
import type { RuleAction } from '@service/rules/rule-schema';

/*
 * A transaction typed by hand (or confirmed from a receipt) goes through the household's rules as
 * soon as it is created, after the person's own choices: a category they picked stays, and so do
 * the description and merchant they typed. Its activity history names the rule that changed it.
 */
describe('rules on a transaction entered by hand', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const accounts = tenantHttp('/v1/account', accountRoutes);
  let position = 0;

  interface HistoryEntry { actorType: string; eventType: string; rules?: { name: string; ruleKey: number }[]; source: null | string }

  async function addRule(household: Household, owner: Appuser, name: string, actions: RuleAction[]): Promise<Rule> {
    const em = db.em();
    const rule = em.create(Rule, { actions, active: true, conditions: [{ field: 'merchant', operator: 'contains', value: 'netflix' }], match: RuleMatchMode.ALL, name, ownerAppuserKey: owner, position: position++, stopProcessing: false, tenantKey: household.tenant, version: 1 }, { partial: true });
    await em.flush();
    return rule;
  }

  async function enter(household: Household, input: { account?: Account; categoryId?: number; description?: string } = {}): Promise<Transaction> {
    const response = await accounts.as(household.appuser).post(`/v1/account/${(input.account ?? household.account).accountKey}/transaction`).send({
      categoryId: input.categoryId ? String(input.categoryId) : undefined,
      description: input.description,
      settlementAmount: 12.99,
      settlementCurrencyId: household.currency.currencyKey,
      transactionDate: '2026-07-20T12:00:00Z',
      transactionMerchantName: 'Netflix',
      transactionTypeId: household.types.cardPayment.transactionTypeKey,
    });
    expect(response.status).toBe(201);
    return db.em().findOneOrFail(Transaction, { accountKey: input.account ?? household.account }, { filters: false, orderBy: { transactionKey: 'DESC' } });
  }

  const categoryOf = (transaction: Transaction) => db.em().find(AppuserTransactionCategory, { transactionKey: transaction }, { filters: false, populate: ['categoryKey'] });

  async function history(household: Household, transaction: Transaction): Promise<HistoryEntry[]> {
    const response = await accounts.as(household.appuser).get(`/v1/account/transaction/${transaction.transactionKey}/history`);
    expect(response.status).toBe(200);
    return response.body.history as HistoryEntry[];
  }

  it('categorizes an uncategorized entry by the rule, and its history names the rule', async () => {
    const owner = await seedHousehold(db.em());
    const streaming = await addCategory(db.em(), owner, 'Streaming');
    const rule = await addRule(owner, owner.appuser, 'Streaming services', [{ categoryId: streaming.categoryKey, type: 'set_category' }]);

    const created = await enter(owner);

    expect(await categoryOf(created)).toEqual([expect.objectContaining({ categoryKey: expect.objectContaining({ categoryKey: streaming.categoryKey }), source: Source.RULE })]);
    const entries = await history(owner, created);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorType: 'user', eventType: 'created' }),
      expect.objectContaining({ actorType: 'system', eventType: 'categorized', rules: [{ name: 'Streaming services', ruleKey: rule.ruleKey }], source: 'rule' }),
    ]));
  });

  it('keeps the category, description and merchant the person chose, and applies the rest of the rule', async () => {
    const owner = await seedHousehold(db.em());
    const chosen = await addCategory(db.em(), owner, 'Chosen');
    const streaming = await addCategory(db.em(), owner, 'Streaming');
    await addRule(owner, owner.appuser, 'Rename', [{ categoryId: streaming.categoryKey, type: 'set_category' }, { type: 'set_description', value: 'Renamed' }, { merchantName: 'Renamed', type: 'set_merchant' }, { type: 'set_notes', value: 'from a rule' }]);

    const created = await enter(owner, { categoryId: chosen.categoryKey, description: 'My Netflix' });

    expect(await categoryOf(created)).toEqual([expect.objectContaining({ categoryKey: expect.objectContaining({ categoryKey: chosen.categoryKey }) })]);
    const stored = await db.em().findOneOrFail(Transaction, { transactionKey: created.transactionKey }, { filters: false, populate: ['transactionMerchantKey'] });
    expect(stored).toMatchObject({ categorizationReason: 'user_edit', description: 'My Netflix', notes: 'from a rule' });
    expect(stored.transactionMerchantKey?.name).toBe('Netflix');
  });

  it('never applies the partner\'s rule to an entry on the owner\'s private account, nor another household\'s rule', async () => {
    const owner = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), owner);
    const privateAccount = await addAccount(db.em(), owner, { isPrivate: true });
    const neighbour = await seedHousehold(db.em());
    await addRule(owner, partner, 'Partner', [{ type: 'set_notes', value: 'partner rule' }]);
    await addRule(neighbour, neighbour.appuser, 'Neighbour', [{ type: 'hide' }]);

    const shared = await enter(owner);
    const secret = await enter(owner, { account: privateAccount });

    expect(await db.em().findOneOrFail(Transaction, { transactionKey: shared.transactionKey }, { filters: false })).toMatchObject({ hidden: false, notes: 'partner rule' });
    expect(await db.em().findOneOrFail(Transaction, { transactionKey: secret.transactionKey }, { filters: false })).toMatchObject({ hidden: false, notes: null });
    expect((await history(owner, secret)).filter((entry) => entry.source === 'rule')).toEqual([]);
  });

  it('still names a rule deleted since in the history', async () => {
    const owner = await seedHousehold(db.em());
    const rule = await addRule(owner, owner.appuser, 'Old rule', [{ type: 'set_notes', value: 'from a rule' }]);
    const created = await enter(owner);
    await db.em().nativeUpdate(Rule, { ruleKey: rule.ruleKey }, { deletedAt: new Date() });

    const entries = await history(owner, created);

    expect(entries.find((entry) => entry.source === 'rule')).toMatchObject({ rules: [{ name: 'Old rule', ruleKey: rule.ruleKey }] });
  });
});
