import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addMerchant, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { AppuserMerchantCategory } from '@entity/AppuserMerchantCategory';
import { Category } from '@entity/Category';
import { Rule, RuleMatchMode } from '@entity/Rule';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import type { TransactionMerchant } from '@entity/TransactionMerchant';
import { applyRulesToTransactions } from '@service/rules/rule-application.service';
import type { RuleCondition } from '@service/rules/rule-schema';
import { RULE_SUGGESTION_POLICY } from '@service/rules/rule-suggestion-pattern';
import { dismissRuleSuggestion, suggestRuleAfterRecategorization } from '@service/rules/rule-suggestion.service';
import { applyBulkTransactionChange, BULK_CHANGE_POPULATE } from '@service/transaction/transaction-bulk-update.service';

/*
 * After a member recategorizes by hand, WonderMoney offers the rule that would have done it:
 * when the same merchant, or the same cleaned description prefix, was moved to the same category
 * by that member's own changes at least three times within 90 days. It does not offer what a rule
 * or the learned merchant mapping already does, nor a suggestion the member dismissed. Only the
 * member's own manual changes count: not the other member's, not an assistant proposal they
 * confirmed, not a rule's, and never a change to a transaction they can no longer see.
 */
describe('rule suggestions after manual recategorization', () => {
  const db = useTestDatabase();
  const march = (day: number) => new Date(`2026-03-${String(day).padStart(2, '0')}T12:00:00Z`);
  let day = 0;

  async function row(household: Household, description: string, input: { account?: Account; appuser?: Appuser; merchant?: TransactionMerchant } = {}): Promise<Transaction> {
    const em = db.em();
    const created = await addTransaction(em, household, { account: input.account, amount: -20, appuser: input.appuser, date: march(++day % 28 + 1), merchant: input.merchant, status: 'BOOKED' });
    created.description = description;
    await em.flush();
    return created;
  }

  /**
   * Categorize `rows` as `member` through the bulk change (the endpoint's own service), with its
   * audit `source`, then ask for a suggestion for the rows it moved, as the endpoint does.
   */
  async function recategorize(household: Household, member: Appuser, rows: Transaction[], category: Category, options: { auditSource?: string; now?: Date } = {}) {
    const em = db.em();
    em.clear();
    const loaded = await em.find(Transaction, { transactionKey: { $in: rows.map((transaction) => transaction.transactionKey) } }, { filters: false, populate: [...BULK_CHANGE_POPULATE] });
    const actor = await em.findOneOrFail(Appuser, { appuserKey: member.appuserKey }, { filters: false });
    const tenant = await em.findOneOrFail(Tenant, { tenantKey: household.tenant.tenantKey }, { filters: false });
    const managedCategory = await em.findOneOrFail(Category, { categoryKey: category.categoryKey }, { filters: false });
    const { recategorizedTransactionKeys } = await applyBulkTransactionChange(em, { appuser: actor, tenant }, loaded, { category: managedCategory }, { auditSource: options.auditSource });
    return suggestRuleAfterRecategorization(em, { appuserKey: member.appuserKey, category: managedCategory, now: options.now, tenantKey: household.tenant.tenantKey, transactionKeys: recategorizedTransactionKeys });
  }

  async function backdate(transaction: Transaction, at: Date): Promise<void> {
    await db.em().execute('update transaction_audit_log set created_at = ? where transaction_key = ?', [at, transaction.transactionKey]);
  }

  async function addRule(household: Household, conditions: RuleCondition[], category: Category, active = true): Promise<Rule> {
    const em = db.em();
    const rule = em.create(Rule, { actions: [{ categoryId: category.categoryKey, type: 'set_category' }], active, conditions, match: RuleMatchMode.ALL, name: 'Rule', ownerAppuserKey: household.appuser, position: ++day, stopProcessing: false, tenantKey: household.tenant, version: 1 }, { partial: true });
    await em.flush();
    return rule;
  }

  async function lidlHousehold() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const groceries = await addCategory(em, owner, 'Groceries');
    const dining = await addCategory(em, owner, 'Dining');
    const lidl = await addMerchant(em, owner, 'Lidl');
    // Card descriptors carry a card number and a city, so learned categorization never recognises them.
    const lidlRows = await Promise.all(['COMPRA 1192 LIDL LISBOA', 'COMPRA 1192 LIDL PORTO', 'COMPRA 4589 LIDL BRAGA', 'COMPRA 1192 LIDL FARO'].map((description) => row(owner, description, { merchant: lidl })));
    return { dining, groceries, lidl, lidlRows, owner };
  }

  describe('detecting a pattern', () => {
    it('suggests a rule on the third matching change, and not on the first two', async () => {
      const { groceries, lidlRows: [first, second, third], owner } = await lidlHousehold();

      expect(await recategorize(owner, owner.appuser, [first!], groceries)).toBeNull();
      expect(await recategorize(owner, owner.appuser, [second!], groceries)).toBeNull();
      const suggestion = await recategorize(owner, owner.appuser, [third!], groceries);

      expect(suggestion).toEqual({
        category: { categoryKey: groceries.categoryKey, name: 'Groceries' },
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        kind: 'merchant',
        matchCount: 3,
        rule: { actions: [{ categoryId: groceries.categoryKey, type: 'set_category' }], conditions: [{ field: 'merchant', operator: 'equals', value: 'Lidl' }], match: 'all', name: 'Lidl', stopProcessing: false },
        windowDays: RULE_SUGGESTION_POLICY.windowDays,
      });
    });

    it('groups descriptions by their cleaned prefix, whatever reference follows it', async () => {
      const em = db.em();
      const owner = await seedHousehold(em);
      const family = await addCategory(em, owner, 'Family');
      const transfers = await Promise.all(['TRF MB WAY 912345678 JOAO', 'TRF MB WAY 913333333 ANA', 'TRF MB WAY 961111111 RUI'].map((description) => row(owner, description)));

      await recategorize(owner, owner.appuser, [transfers[0]!], family);
      await recategorize(owner, owner.appuser, [transfers[1]!], family);
      const suggestion = await recategorize(owner, owner.appuser, [transfers[2]!], family);

      expect(suggestion).toMatchObject({ kind: 'description', matchCount: 3, rule: { conditions: [{ field: 'description', operator: 'starts_with', source: 'cleaned', value: 'TRF MB WAY' }], name: 'TRF MB WAY' } });
    });

    it('counts a bulk change once per transaction', async () => {
      const { groceries, lidlRows: [first, second, third], owner } = await lidlHousehold();

      expect(await recategorize(owner, owner.appuser, [first!, second!], groceries)).toBeNull();
      expect(await recategorize(owner, owner.appuser, [third!], groceries)).toMatchObject({ matchCount: 3 });
    });

    it('suggests straight away when one bulk change moves three matching transactions', async () => {
      const { groceries, lidlRows: [first, second, third], owner } = await lidlHousehold();

      expect(await recategorize(owner, owner.appuser, [first!, second!, third!], groceries)).toMatchObject({ kind: 'merchant', matchCount: 3 });
    });

    it('counts each transaction once, by its latest change, and only into the same category', async () => {
      const { dining, groceries, lidlRows: [first, second, third], owner } = await lidlHousehold();
      await recategorize(owner, owner.appuser, [first!], groceries);
      await recategorize(owner, owner.appuser, [first!], dining);
      await recategorize(owner, owner.appuser, [first!], groceries);
      await recategorize(owner, owner.appuser, [second!], dining);

      expect(await recategorize(owner, owner.appuser, [third!], groceries)).toBeNull();
    });

    it('counts a change made exactly 90 days ago, but not one made a moment before that', async () => {
      const { groceries, lidlRows: [first, second, third, fourth], owner } = await lidlHousehold();
      const now = new Date();
      const edge = new Date(now.getTime() - RULE_SUGGESTION_POLICY.windowDays * 24 * 60 * 60 * 1000);
      await recategorize(owner, owner.appuser, [first!, second!], groceries);
      await backdate(first!, edge);
      await backdate(second!, new Date(edge.getTime() - 1000));

      expect(await recategorize(owner, owner.appuser, [third!], groceries, { now })).toBeNull();
      expect(await recategorize(owner, owner.appuser, [fourth!], groceries, { now })).toMatchObject({ matchCount: 3 });
    });
  });

  describe('what is already covered', () => {
    it('does not suggest what an active rule already does', async () => {
      const { groceries, lidlRows: [first, second, third], owner } = await lidlHousehold();
      await addRule(owner, [{ field: 'merchant', operator: 'contains', value: 'lidl' }], groceries);
      await recategorize(owner, owner.appuser, [first!, second!], groceries);

      expect(await recategorize(owner, owner.appuser, [third!], groceries)).toBeNull();
    });

    it('still suggests when the matching rule is switched off or sets another category', async () => {
      const { dining, groceries, lidlRows: [first, second, third], owner } = await lidlHousehold();
      await addRule(owner, [{ field: 'merchant', operator: 'contains', value: 'lidl' }], groceries, false);
      await addRule(owner, [{ field: 'merchant', operator: 'contains', value: 'lidl' }], dining);
      await recategorize(owner, owner.appuser, [first!, second!], groceries);

      expect(await recategorize(owner, owner.appuser, [third!], groceries)).toMatchObject({ kind: 'merchant' });
    });

    it('does not suggest what the learned merchant mapping already does', async () => {
      const em = db.em();
      const owner = await seedHousehold(em);
      const groceries = await addCategory(em, owner, 'Groceries');
      const continente = await addMerchant(em, owner, 'Continente');
      // The description is the merchant's name: learned categorization recognises the next one.
      const rows = await Promise.all([1, 2, 3].map(() => row(owner, 'Continente', { merchant: continente })));
      await recategorize(owner, owner.appuser, [rows[0]!, rows[1]!], groceries);

      expect(await em.count(AppuserMerchantCategory, { appuserKey: owner.appuser, categoryKey: groceries, deletedAt: null })).toBe(1);
      expect(await recategorize(owner, owner.appuser, [rows[2]!], groceries)).toBeNull();
    });

    it('does not suggest a suggestion the member dismissed', async () => {
      const { groceries, lidlRows: [first, second, third, fourth], owner } = await lidlHousehold();
      await recategorize(owner, owner.appuser, [first!, second!], groceries);
      const suggestion = await recategorize(owner, owner.appuser, [third!], groceries);

      await dismissRuleSuggestion(db.em(), owner.appuser.appuserKey, suggestion!.fingerprint);
      await dismissRuleSuggestion(db.em(), owner.appuser.appuserKey, suggestion!.fingerprint);

      // The merchant suggestion is gone; the description prefix ("LIDL" after the card header) is a separate one.
      const next = await recategorize(owner, owner.appuser, [fourth!], groceries);
      expect(next?.fingerprint).not.toBe(suggestion!.fingerprint);
      expect(next).toMatchObject({ kind: 'description', rule: { conditions: [{ field: 'description', operator: 'contains', value: 'LIDL' }] } });
    });
  });

  describe('whose changes count', () => {
    it('does not count categorizations from a confirmed assistant proposal', async () => {
      const { groceries, lidlRows: [first, second, third], owner } = await lidlHousehold();
      await recategorize(owner, owner.appuser, [first!, second!], groceries, { auditSource: 'assistant-proposal' });

      expect(await recategorize(owner, owner.appuser, [third!], groceries)).toBeNull();
    });

    it('does not count categorizations a rule made, as on import and bank sync', async () => {
      const { groceries, lidlRows: [first, second, third], owner } = await lidlHousehold();
      const rule = await addRule(owner, [{ field: 'merchant', operator: 'contains', value: 'lidl' }], groceries);
      await applyRulesToTransactions(db.em(), owner.tenant.tenantKey, [first!.transactionKey, second!.transactionKey]);
      rule.active = false;
      await db.em().flush();

      expect(await recategorize(owner, owner.appuser, [third!], groceries)).toBeNull();
    });

    it('counts only the member\'s own changes, not the other member\'s', async () => {
      const { groceries, lidlRows: [first, second, third], owner } = await lidlHousehold();
      const partner = await addPartner(db.em(), owner);
      await recategorize(owner, partner, [first!, second!], groceries);

      expect(await recategorize(owner, owner.appuser, [third!], groceries)).toBeNull();
    });

    it('never counts the other member\'s private-account transactions, even ones changed before the account went private', async () => {
      const em = db.em();
      const { groceries, lidl, owner } = await lidlHousehold();
      const partner = await addPartner(em, owner);
      const partnersAccount = await addAccount(em, owner, { owner: partner });
      const theirs = await Promise.all(['COMPRA 1 LIDL GAIA', 'COMPRA 2 LIDL MAIA'].map((description) => row(owner, description, { account: partnersAccount, appuser: partner, merchant: lidl })));
      await recategorize(owner, owner.appuser, theirs, groceries);
      partnersAccount.isPrivate = true;
      await em.flush();
      const mine = await row(owner, 'COMPRA 3 LIDL LISBOA', { merchant: lidl });

      expect(await recategorize(owner, owner.appuser, [mine], groceries)).toBeNull();
    });

    it('counts the member\'s own private-account transactions', async () => {
      const em = db.em();
      const { groceries, lidl, owner } = await lidlHousehold();
      const ownPrivate = await addAccount(em, owner, { isPrivate: true });
      const rows = await Promise.all(['COMPRA 1 LIDL GAIA', 'COMPRA 2 LIDL MAIA', 'COMPRA 3 LIDL LISBOA'].map((description) => row(owner, description, { account: ownPrivate, merchant: lidl })));

      expect(await recategorize(owner, owner.appuser, rows, groceries)).toMatchObject({ matchCount: 3 });
    });

    it('never counts another household\'s changes', async () => {
      const em = db.em();
      const owner = await seedHousehold(em);
      const neighbour = await seedHousehold(em);
      const family = await addCategory(em, owner, 'Family');
      const theirFamily = await addCategory(em, neighbour, 'Family');
      const theirs = await Promise.all(['TRF MB WAY 1 ANA', 'TRF MB WAY 2 RUI'].map((description) => row(neighbour, description)));
      await recategorize(neighbour, neighbour.appuser, theirs, theirFamily);
      const mine = await row(owner, 'TRF MB WAY 3 JOAO');

      expect(await recategorize(owner, owner.appuser, [mine], family)).toBeNull();
    });
  });
});
