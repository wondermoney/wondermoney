import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));

import { addAccount, addCategory, addMerchant, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Rule, RuleMatchMode } from '@entity/Rule';
import { Tag } from '@entity/Tag';
import { CategorizationConfidence, Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionTag } from '@entity/TransactionTag';
import { applyRulesToTransactions } from '@service/rules/rule-application.service';
import type { RuleAction, RuleCondition } from '@service/rules/rule-schema';
import { transactionCreationService } from '@service/transaction/transaction-creation.service';

/*
 * Applying rules writes what the engine planned, with one audit entry per changed transaction.
 * It reads and changes only the household's own transactions, and a rule never touches the
 * other member's private-account transactions, whatever keys the caller passes.
 */
describe('applyRulesToTransactions', () => {
  const db = useTestDatabase();

  const netflixMerchant: RuleCondition = { field: 'description', operator: 'contains', source: 'cleaned', value: 'netflix' };
  let position = 0;

  async function addRule(household: Household, owner: Appuser | null, actions: RuleAction[], conditions: RuleCondition[] = [netflixMerchant]): Promise<Rule> {
    const em = db.em();
    const rule = em.create(Rule, { actions, active: true, conditions, match: RuleMatchMode.ALL, name: 'Rule', ownerAppuserKey: owner, position: position++, stopProcessing: false, tenantKey: household.tenant, version: 1 }, { partial: true });
    await em.flush();
    return rule;
  }

  async function netflixPayment(household: Household, overrides: Partial<Parameters<typeof addTransaction>[2]> = {}): Promise<Transaction> {
    const merchant = await addMerchant(db.em(), household, `Netflix ${position++}`);
    return addTransaction(db.em(), household, { amount: -12.99, date: new Date('2026-07-10T12:00:00Z'), merchant, status: 'BOOKED', ...overrides });
  }

  const apply = (household: Household, transactions: Transaction[]) => applyRulesToTransactions(db.em(), household.tenant.tenantKey, transactions.map((transaction) => transaction.transactionKey));

  const reload = (transaction: Transaction) => db.em().findOneOrFail(Transaction, { transactionKey: transaction.transactionKey }, { filters: false, populate: ['appuserTransactionCategories', 'transactionMerchantKey'] });

  const categoryOf = async (transaction: Transaction) => (await db.em().findOne(AppuserTransactionCategory, { transactionKey: transaction }, { filters: false }));

  async function households() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const privateAccount = await addAccount(em, owner, { isPrivate: true });
    const neighbour = await seedHousehold(em);
    return { neighbour, owner, partner, privateAccount };
  }

  describe('writing the changes', () => {
    it('categorizes as the rule, stamps the reason and audits it as a system edit naming the rule', async () => {
      const { owner } = await households();
      const streaming = await addCategory(db.em(), owner, 'Streaming');
      const rule = await addRule(owner, owner.appuser, [{ categoryId: streaming.categoryKey, type: 'set_category' }]);
      const payment = await netflixPayment(owner);

      const applied = await apply(owner, [payment]);

      expect(applied.map((evaluation) => evaluation.transactionKey)).toEqual([payment.transactionKey]);
      expect(await categoryOf(payment)).toMatchObject({ categoryKey: { categoryKey: streaming.categoryKey }, source: Source.RULE });
      expect(await reload(payment)).toMatchObject({ categorizationConfidence: CategorizationConfidence.HIGH, categorizationReason: `rule:${rule.ruleKey}` });
      const audit = await db.em().find(TransactionAuditLog, { transactionKey: payment }, { filters: false });
      expect(audit).toEqual([expect.objectContaining({
        actorAppuserKey: null,
        actorType: TransactionAuditActorType.SYSTEM,
        changes: { categoryKey: { from: null, to: streaming.categoryKey }, ruleKeys: { from: null, to: [rule.ruleKey] } },
        eventType: TransactionAuditEventType.CATEGORIZED,
        source: 'rule',
      })]);
    });

    it('moves an existing category that no person chose', async () => {
      const { owner } = await households();
      const old = await addCategory(db.em(), owner, 'Old');
      const streaming = await addCategory(db.em(), owner, 'Streaming');
      await addRule(owner, owner.appuser, [{ categoryId: streaming.categoryKey, type: 'set_category' }]);
      const payment = await netflixPayment(owner, { category: old });

      await apply(owner, [payment]);

      expect(await db.em().find(AppuserTransactionCategory, { transactionKey: payment }, { filters: false })).toEqual([expect.objectContaining({ categoryKey: expect.objectContaining({ categoryKey: streaming.categoryKey }) })]);
    });

    it('renames, describes, notes, reviews, hides and tags', async () => {
      const { owner } = await households();
      const tag = (db.em().create(Tag, { color: '#94a3b8', name: 'Subscriptions', tenantKey: owner.tenant }, { partial: true }));
      await db.em().persist(tag).flush();
      const rule = await addRule(owner, owner.appuser, [
        { merchantName: 'Netflix International', type: 'set_merchant' },
        { type: 'set_description', value: 'Netflix' },
        { type: 'set_notes', value: 'Family plan' },
        { type: 'mark_reviewed' },
        { type: 'hide' },
        { tagIds: [tag.tagKey], type: 'add_tags' },
      ]);
      const first = await netflixPayment(owner);
      const second = await netflixPayment(owner);

      await apply(owner, [first, second]);

      for (const payment of [first, second]) {
        const stored = await reload(payment);
        expect(stored).toMatchObject({ description: 'Netflix', hidden: true, notes: 'Family plan', reviewed: true });
        expect(stored.transactionMerchantKey?.name).toBe('Netflix International');
        expect(await db.em().count(TransactionTag, { tagKey: tag, transactionKey: payment }, { filters: false })).toBe(1);
        const [entry] = await db.em().find(TransactionAuditLog, { transactionKey: payment }, { filters: false });
        expect(entry).toMatchObject({ eventType: TransactionAuditEventType.SYSTEM_EDIT, source: 'rule' });
        expect(entry?.changes).toMatchObject({ description: { to: 'Netflix' }, hidden: { from: false, to: true }, notes: { from: null, to: 'Family plan' }, reviewed: { from: false, to: true }, ruleKeys: { to: [rule.ruleKey] }, tagKeys: { from: [], to: [tag.tagKey] } });
      }
      expect(await db.em().count(TransactionMerchant, { name: 'Netflix International' }, { filters: false })).toBe(1);
    });

    it('leaves a transaction no rule changes untouched and unaudited', async () => {
      const { owner } = await households();
      await addRule(owner, owner.appuser, [{ type: 'hide' }], [{ field: 'description', operator: 'contains', source: 'cleaned', value: 'spotify' }]);
      const payment = await netflixPayment(owner);

      expect(await apply(owner, [payment])).toEqual([]);
      expect(await db.em().count(TransactionAuditLog, {}, { filters: false })).toBe(0);
    });

    it('skips a category or tag deleted since the rule was saved', async () => {
      const { owner } = await households();
      const gone = await addCategory(db.em(), owner, 'Gone');
      gone.deletedAt = new Date();
      await db.em().upsert(gone);
      const tag = db.em().create(Tag, { color: '#94a3b8', deletedAt: new Date(), name: 'Gone', tenantKey: owner.tenant }, { partial: true });
      await db.em().persist(tag).flush();
      await addRule(owner, owner.appuser, [{ categoryId: gone.categoryKey, type: 'set_category' }, { tagIds: [tag.tagKey], type: 'add_tags' }, { type: 'mark_reviewed' }]);
      const payment = await netflixPayment(owner);

      await apply(owner, [payment]);

      expect(await categoryOf(payment)).toBeNull();
      expect(await db.em().count(TransactionTag, {}, { filters: false })).toBe(0);
      expect(await reload(payment)).toMatchObject({ reviewed: true });
    });

    it('never changes a category the user chose', async () => {
      const { owner } = await households();
      const chosen = await addCategory(db.em(), owner, 'Chosen');
      const streaming = await addCategory(db.em(), owner, 'Streaming');
      await addRule(owner, owner.appuser, [{ categoryId: streaming.categoryKey, type: 'set_category' }]);
      const payment = await netflixPayment(owner, { category: chosen });
      const em = db.em();
      await em.nativeUpdate(Transaction, { transactionKey: payment.transactionKey }, { categorizationReason: 'user_edit' });

      expect(await apply(owner, [payment])).toEqual([]);
      expect(await categoryOf(payment)).toMatchObject({ categoryKey: { categoryKey: chosen.categoryKey } });
    });

    it('never changes a description or merchant the user set', async () => {
      const { owner } = await households();
      await addRule(owner, owner.appuser, [{ type: 'set_description', value: 'Renamed' }, { merchantName: 'Renamed', type: 'set_merchant' }]);
      const payment = await netflixPayment(owner);
      await db.em().nativeUpdate(Transaction, { transactionKey: payment.transactionKey }, { descriptionEditedByUser: true, merchantEditedByUser: true });

      expect(await apply(owner, [payment])).toEqual([]);
      expect((await reload(payment)).description).toBe(payment.description);
    });
  });

  describe('entries typed by hand', () => {
    const create = (household: Household, enteredByHand: boolean) => transactionCreationService.createTransaction({
      accountId: household.account.accountKey,
      appuserKey: household.appuser.appuserKey,
      description: 'NETFLIX.COM 1234',
      enteredByHand,
      settlementAmount: 12.99,
      settlementCurrencyId: household.currency.currencyKey,
      transactionDate: new Date('2026-07-10T12:00:00Z'),
      transactionMerchantName: 'Netflix',
      transactionTypeId: household.types.cardPayment.transactionTypeKey,
    });

    it('keeps the description and merchant a person typed, but renames an imported row', async () => {
      const { owner } = await households();
      await addRule(owner, owner.appuser, [{ type: 'set_description', value: 'Netflix' }, { merchantName: 'Streaming', type: 'set_merchant' }]);
      const typed = await create(owner, true);
      const imported = await create(owner, false);

      await apply(owner, [typed, imported]);

      expect(await reload(typed)).toMatchObject({ description: 'NETFLIX.COM 1234', transactionMerchantKey: expect.objectContaining({ name: 'Netflix' }) });
      expect(await reload(imported)).toMatchObject({ description: 'Netflix', transactionMerchantKey: expect.objectContaining({ name: 'Streaming' }) });
    });
  });

  describe('whose transactions', () => {
    it('ignores another household\'s transaction passed in by key', async () => {
      const { neighbour, owner } = await households();
      await addRule(owner, owner.appuser, [{ type: 'hide' }]);
      const theirs = await netflixPayment(neighbour);

      expect(await apply(owner, [theirs])).toEqual([]);
      expect(await reload(theirs)).toMatchObject({ hidden: false });
    });

    it('never applies another household\'s rules', async () => {
      const { neighbour, owner } = await households();
      await addRule(neighbour, neighbour.appuser, [{ type: 'hide' }]);
      const mine = await netflixPayment(owner);

      expect(await apply(owner, [mine])).toEqual([]);
      expect(await reload(mine)).toMatchObject({ hidden: false });
    });

    it('applies the partner\'s rule to a shared account but not to the owner\'s private account', async () => {
      const { owner, partner, privateAccount } = await households();
      await addRule(owner, partner, [{ type: 'set_notes', value: 'partner rule' }]);
      const shared = await netflixPayment(owner);
      const secret = await netflixPayment(owner, { account: privateAccount });

      await apply(owner, [shared, secret]);

      expect(await reload(shared)).toMatchObject({ notes: 'partner rule' });
      expect(await reload(secret)).toMatchObject({ notes: null });
      expect(await db.em().count(TransactionAuditLog, { transactionKey: secret }, { filters: false })).toBe(0);
    });

    it('applies the owner\'s own rule to their private account', async () => {
      const { owner, privateAccount } = await households();
      await addRule(owner, owner.appuser, [{ type: 'set_notes', value: 'mine' }]);
      const secret = await netflixPayment(owner, { account: privateAccount });

      await apply(owner, [secret]);

      expect(await reload(secret)).toMatchObject({ notes: 'mine' });
    });

    it('does not let a rule whose owner is gone touch a private account', async () => {
      const { owner, privateAccount } = await households();
      await addRule(owner, null, [{ type: 'hide' }]);
      const secret = await netflixPayment(owner, { account: privateAccount });

      expect(await apply(owner, [secret])).toEqual([]);
    });
  });
});
