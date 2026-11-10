import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addMerchant, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';
import { Rule, RuleMatchMode } from '@entity/Rule';
import { Transaction } from '@entity/Transaction';
import { applyRulesToTransactions } from '@service/rules/rule-application.service';
import { previewRule, type RuleDraft } from '@service/rules/rule-preview.service';
import type { RuleCondition } from '@service/rules/rule-schema';

/*
 * The preview answers "what would this unsaved rule do?" without writing anything. It judges the
 * household's live transactions (hidden ones included) as the rule's would-be owner, the member
 * previewing: it never counts or shows another household's rows or the other member's
 * private-account rows, and it applies the same user-edit protection as the engine, so the
 * number of changes it reports is the number applying the rule would make.
 */
describe('previewRule', () => {
  const db = useTestDatabase();

  const netflix: RuleCondition = { field: 'description', operator: 'contains', source: 'cleaned', value: 'netflix' };
  let sequence = 0;

  async function households() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const ownersPrivate = await addAccount(em, owner, { isPrivate: true, name: 'Owner private' });
    const partnersPrivate = await addAccount(em, owner, { isPrivate: true, name: 'Partner private', owner: partner });
    const neighbour = await seedHousehold(em);
    return { neighbour, owner, ownersPrivate, partner, partnersPrivate };
  }

  async function netflixPayment(household: Household, overrides: Partial<Parameters<typeof addTransaction>[2]> = {}): Promise<Transaction> {
    const merchant = await addMerchant(db.em(), household, `Netflix ${++sequence}`);
    return addTransaction(db.em(), household, { amount: -12.99, date: new Date(`2026-07-${String(10 + (sequence % 18)).padStart(2, '0')}T12:00:00Z`), merchant, status: 'BOOKED', ...overrides });
  }

  const preview = (household: Household, actor: Appuser, draft: RuleDraft, limit?: number) =>
    previewRule(db.em(), { appuserKey: actor.appuserKey, tenantKey: household.tenant.tenantKey }, draft, { limit });

  async function update(transaction: Transaction, changes: Partial<Transaction>) {
    const em = db.em();
    const row = await em.findOneOrFail(Transaction, { transactionKey: transaction.transactionKey }, { filters: false });
    Object.assign(row, changes);
    await em.flush();
  }

  describe('what it counts', () => {
    it('counts the household\'s matching rows, hidden ones included, and only those a change would reach', async () => {
      const { owner } = await households();
      const streaming = await addCategory(db.em(), owner, 'Streaming');
      const plain = await netflixPayment(owner);
      const hidden = await netflixPayment(owner, { hidden: true });
      const alreadyStreaming = await netflixPayment(owner, { category: streaming });
      const userChosen = await netflixPayment(owner);
      await update(userChosen, { categorizationReason: 'user_edit' });
      const deleted = await netflixPayment(owner);
      await update(deleted, { deletedAt: new Date() });
      await addTransaction(db.em(), owner, { amount: -40, date: new Date('2026-07-12T12:00:00Z'), status: 'BOOKED' });

      const result = await preview(owner, owner.appuser, { actions: [{ categoryId: streaming.categoryKey, type: 'set_category' }], conditions: [netflix], match: 'all' });

      expect(result.matchCount).toBe(4);
      expect(result.changeCount).toBe(2);
      const keys = result.transactions.map((row) => row.transactionKey);
      expect(keys.sort()).toEqual([plain, hidden, alreadyStreaming, userChosen].map((row) => row.transactionKey).sort());
      expect(result.transactions.find((row) => row.transactionKey === plain.transactionKey)?.changes).toEqual({ categoryKey: streaming.categoryKey });
      expect(result.transactions.find((row) => row.transactionKey === userChosen.transactionKey)?.changes).toEqual({});
    });

    it('reports exactly the changes applying the saved rule then makes', async () => {
      const { owner, ownersPrivate, partner } = await households();
      const streaming = await addCategory(db.em(), owner, 'Streaming');
      const merchantChosen = await netflixPayment(owner);
      await netflixPayment(owner, { category: streaming });
      await netflixPayment(owner, { account: ownersPrivate });
      await netflixPayment(owner, { hidden: true });
      const withNotes = await netflixPayment(owner, { amount: 30 });
      await update(merchantChosen, { merchantEditedByUser: true });
      await update(withNotes, { notes: 'mine' });
      const draft: RuleDraft = {
        actions: [{ categoryId: streaming.categoryKey, type: 'set_category' }, { merchantName: 'Netflix', type: 'set_merchant' }, { type: 'set_notes', value: 'subscription' }, { type: 'mark_reviewed' }],
        conditions: [netflix],
        match: 'all',
      };

      const forOwner = await preview(owner, owner.appuser, draft);
      const forPartner = await preview(owner, partner, draft);

      const em = db.em();
      em.create(Rule, { actions: draft.actions, active: true, conditions: draft.conditions, match: RuleMatchMode.ALL, name: 'Netflix', ownerAppuserKey: owner.appuser, position: 0, stopProcessing: false, tenantKey: owner.tenant, version: 1 }, { partial: true });
      await em.flush();
      const allKeys = (await db.em().find(Transaction, {}, { filters: false })).map((row) => row.transactionKey);
      const applied = await applyRulesToTransactions(db.em(), owner.tenant.tenantKey, allKeys);

      expect(forOwner.changeCount).toBe(applied.length);
      expect(forOwner.transactions.filter((row) => Object.keys(row.changes).length > 0).map((row) => row.transactionKey).sort()).toEqual(applied.map((evaluation) => evaluation.transactionKey).sort());
      expect(forPartner.matchCount).toBe(forOwner.matchCount - 1);
    });

    it('writes nothing', async () => {
      const { owner } = await households();
      const streaming = await addCategory(db.em(), owner, 'Streaming');
      const payment = await netflixPayment(owner);

      await preview(owner, owner.appuser, { actions: [{ categoryId: streaming.categoryKey, type: 'set_category' }, { type: 'hide' }, { merchantName: 'Brand new merchant', type: 'set_merchant' }], conditions: [netflix], match: 'all' });

      expect(await db.em().count(AppuserTransactionCategory, { transactionKey: payment }, { filters: false })).toBe(0);
      expect(await db.em().findOneOrFail(Transaction, { transactionKey: payment.transactionKey }, { filters: false })).toMatchObject({ hidden: false });
      expect((await db.em().find(Transaction, {}, { filters: false, populate: ['transactionMerchantKey'] })).some((row) => row.transactionMerchantKey?.name === 'Brand new merchant')).toBe(false);
    });
  });

  describe('scoping', () => {
    it('never counts or shows another household\'s rows', async () => {
      const { neighbour, owner } = await households();
      await netflixPayment(neighbour);
      const ours = await netflixPayment(owner);

      const result = await preview(owner, owner.appuser, { actions: [{ type: 'hide' }], conditions: [netflix], match: 'all' });

      expect(result.matchCount).toBe(1);
      expect(result.transactions.map((row) => row.transactionKey)).toEqual([ours.transactionKey]);
    });

    it('never counts or shows the other member\'s private-account rows, but does show the previewer\'s own', async () => {
      const { owner, ownersPrivate, partner, partnersPrivate } = await households();
      const shared = await netflixPayment(owner);
      const ownerPrivateRow = await netflixPayment(owner, { account: ownersPrivate });
      const partnerPrivateRow = await netflixPayment(owner, { account: partnersPrivate, appuser: partner });
      const draft: RuleDraft = { actions: [{ type: 'hide' }], conditions: [netflix], match: 'all' };

      const asPartner = await preview(owner, partner, draft);
      const asOwner = await preview(owner, owner.appuser, draft);

      expect(asPartner.matchCount).toBe(2);
      expect(asPartner.transactions.map((row) => row.transactionKey).sort()).toEqual([shared, partnerPrivateRow].map((row) => row.transactionKey).sort());
      expect(asOwner.matchCount).toBe(2);
      expect(asOwner.transactions.map((row) => row.transactionKey).sort()).toEqual([shared, ownerPrivateRow].map((row) => row.transactionKey).sort());
    });

    it('matches a "not in" account condition only within what the previewer can see', async () => {
      const { owner, ownersPrivate, partner } = await households();
      await netflixPayment(owner, { account: ownersPrivate });
      const shared = await netflixPayment(owner);
      const savings = await addAccount(db.em(), owner, { name: 'Savings' });
      await netflixPayment(owner, { account: savings });

      const result = await preview(owner, partner, { actions: [{ type: 'hide' }], conditions: [{ field: 'account', operator: 'not_in', values: [savings.accountKey] }], match: 'all' });

      expect(result.transactions.map((row) => row.transactionKey)).toEqual([shared.transactionKey]);
    });
  });

  describe('the sample', () => {
    it('lists the most recent matches first, up to the limit, while counting them all', async () => {
      const { owner } = await households();
      const older = await netflixPayment(owner, { date: new Date('2026-05-01T12:00:00Z') });
      const newest = await netflixPayment(owner, { date: new Date('2026-08-01T12:00:00Z') });
      const middle = await netflixPayment(owner, { date: new Date('2026-06-01T12:00:00Z') });

      const result = await preview(owner, owner.appuser, { actions: [{ type: 'hide' }], conditions: [netflix], match: 'all' }, 2);

      expect(result.matchCount).toBe(3);
      expect(result.changeCount).toBe(3);
      expect(result.transactions.map((row) => row.transactionKey)).toEqual([newest.transactionKey, middle.transactionKey]);
      expect(result.transactions.map((row) => row.transactionKey)).not.toContain(older.transactionKey);
    });

    it('describes each row and names the merchant a change would set', async () => {
      const { owner } = await households();
      const target = await addMerchant(db.em(), owner, 'Netflix International');
      const payment = await netflixPayment(owner);

      const result = await preview(owner, owner.appuser, { actions: [{ merchantId: target.transactionMerchantKey, type: 'set_merchant' }], conditions: [netflix], match: 'all' });

      expect(result.transactions).toEqual([expect.objectContaining({
        accountName: 'Current account',
        amount: -12.99,
        changes: { merchant: { merchantKey: target.transactionMerchantKey, name: 'Netflix International' } },
        currency: 'EUR',
        description: payment.description,
        transactionKey: payment.transactionKey,
      })]);
    });
  });
});
