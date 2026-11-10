import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addMerchant, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { Category } from '@entity/Category';
import { Rule, RuleMatchMode } from '@entity/Rule';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditLog } from '@entity/TransactionAuditLog';
import { countRuleRun, type RuleRunProgress, type RuleRunScope, runRuleRun, startRuleRun } from '@service/rules/rule-run.service';
import type { RuleAction, RuleCondition } from '@service/rules/rule-schema';

/*
 * Applying rules to existing transactions: a dry run counts exactly what the real run then
 * changes. The run goes through the household's live transactions (hidden ones included) in
 * batches, each committed with its progress, so a run cut short carries on where it stopped.
 * It never touches another household, the other member's private accounts, or a field a person
 * set by hand, and every change is audited naming the rule.
 */
describe('applying rules to existing transactions', () => {
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

  async function addRule(household: Household, owner: Appuser | null, actions: RuleAction[], overrides: Partial<Pick<Rule, 'active' | 'conditions' | 'stopProcessing'>> = {}): Promise<Rule> {
    const em = db.em();
    const rule = em.create(Rule, { actions, active: true, conditions: [netflix], match: RuleMatchMode.ALL, name: `Rule ${++sequence}`, ownerAppuserKey: owner, position: sequence, stopProcessing: false, tenantKey: household.tenant, version: 1, ...overrides }, { partial: true });
    await em.flush();
    return rule;
  }

  async function netflixPayment(household: Household, overrides: Partial<Parameters<typeof addTransaction>[2]> = {}): Promise<Transaction> {
    const merchant = await addMerchant(db.em(), household, `Netflix ${++sequence}`);
    return addTransaction(db.em(), household, { amount: -12.99, date: new Date('2026-07-10T12:00:00Z'), merchant, status: 'BOOKED', ...overrides });
  }

  async function update(transaction: Transaction, changes: Partial<Transaction>) {
    const em = db.em();
    const row = await em.findOneOrFail(Transaction, { transactionKey: transaction.transactionKey }, { filters: false });
    Object.assign(row, changes);
    await em.flush();
  }

  const scopeOf = (household: Household, actor: Appuser, rule: null | Rule): RuleRunScope => ({ appuserKey: actor.appuserKey, ruleKey: rule?.ruleKey ?? null, tenantKey: household.tenant.tenantKey });

  const enqueue = () => ({ send: vi.fn().mockResolvedValue('job-1'), sendAfter: vi.fn() });

  /** Start a run and work it to the end as the worker would, `batchSize` rows at a time. */
  async function applyNow(scope: RuleRunScope, options: { batchSize?: number } = {}): Promise<RuleRunProgress> {
    const { operationId } = await startRuleRun(db.em(), scope, { enqueue: enqueue() });
    await runRuleRun(db.em(), operationId, 'job-1', options);
    return progressOf(operationId);
  }

  async function operation(correlationId: string): Promise<BackgroundOperation> {
    return db.em().findOneOrFail(BackgroundOperation, { correlationId });
  }

  const progressOf = async (correlationId: string) => (await operation(correlationId)).progress as unknown as RuleRunProgress;

  const categoryOf = async (transaction: Transaction) => (await db.em().findOne(AppuserTransactionCategory, { transactionKey: transaction }, { filters: false }))?.categoryKey.categoryKey ?? null;

  const reload = (transaction: Transaction) => db.em().findOneOrFail(Transaction, { transactionKey: transaction.transactionKey }, { filters: false });

  describe('counting and changing', () => {
    it('changes exactly as many transactions as the dry run counted, hidden ones included, deleted and hand-set ones left alone', async () => {
      const { owner } = await households();
      const streaming = await addCategory(db.em(), owner, 'Streaming');
      const rule = await addRule(owner, owner.appuser, [{ categoryId: streaming.categoryKey, type: 'set_category' }, { type: 'mark_reviewed' }]);
      const plain = await netflixPayment(owner);
      const hidden = await netflixPayment(owner, { hidden: true });
      const handSet = await netflixPayment(owner);
      await update(handSet, { categorizationReason: 'user_edit', reviewed: true });
      const deleted = await netflixPayment(owner);
      await update(deleted, { deletedAt: new Date() });
      const other = await addTransaction(db.em(), owner, { amount: -40, date: new Date('2026-07-12T12:00:00Z'), status: 'BOOKED' });
      const scope = scopeOf(owner, owner.appuser, rule);

      const counted = await countRuleRun(db.em(), scope);
      const progress = await applyNow(scope);

      expect(counted).toBe(2);
      expect(progress).toMatchObject({ changed: 2, processed: 4, total: 4 });
      expect(await categoryOf(plain)).toBe(streaming.categoryKey);
      expect(await categoryOf(hidden)).toBe(streaming.categoryKey);
      expect(await categoryOf(handSet)).toBeNull();
      expect(await categoryOf(deleted)).toBeNull();
      expect(await categoryOf(other)).toBeNull();
      expect(await reload(deleted)).toMatchObject({ reviewed: false });
    });

    it('counts a change whose target was deleted since the rule was saved the way the run skips it', async () => {
      const { owner } = await households();
      const gone = await addCategory(db.em(), owner, 'Gone');
      const rule = await addRule(owner, owner.appuser, [{ categoryId: gone.categoryKey, type: 'set_category' }]);
      await netflixPayment(owner);
      const em = db.em();
      const category = await em.findOneOrFail(Category, { categoryKey: gone.categoryKey });
      category.deletedAt = new Date();
      await em.flush();
      const scope = scopeOf(owner, owner.appuser, rule);

      expect(await countRuleRun(db.em(), scope)).toBe(0);
      expect(await applyNow(scope)).toMatchObject({ changed: 0 });
    });

    it('changes nothing the second time', async () => {
      const { owner } = await households();
      const streaming = await addCategory(db.em(), owner, 'Streaming');
      const rule = await addRule(owner, owner.appuser, [{ categoryId: streaming.categoryKey, type: 'set_category' }, { merchantName: 'Netflix', type: 'set_merchant' }, { type: 'set_notes', value: 'subscription' }]);
      await netflixPayment(owner);
      await netflixPayment(owner, { hidden: true });
      const scope = scopeOf(owner, owner.appuser, rule);

      expect(await applyNow(scope)).toMatchObject({ changed: 2 });
      const auditsAfterFirst = await db.em().count(TransactionAuditLog, {}, { filters: false });

      expect(await countRuleRun(db.em(), scope)).toBe(0);
      expect(await applyNow(scope)).toMatchObject({ changed: 0 });
      expect(await db.em().count(TransactionAuditLog, {}, { filters: false })).toBe(auditsAfterFirst);
    });

    it('audits every change it makes, naming the rule', async () => {
      const { owner } = await households();
      const rule = await addRule(owner, owner.appuser, [{ type: 'hide' }]);
      const first = await netflixPayment(owner);
      const second = await netflixPayment(owner);

      await applyNow(scopeOf(owner, owner.appuser, rule));

      const audits = await db.em().find(TransactionAuditLog, {}, { filters: false, orderBy: { transactionKey: 'asc' } });
      expect(audits.map((audit) => audit.transactionKey.transactionKey)).toEqual([first.transactionKey, second.transactionKey]);
      for (const audit of audits) expect(audit).toMatchObject({ changes: { hidden: { from: false, to: true }, ruleKeys: { from: null, to: [rule.ruleKey] } }, source: 'rule' });
    });

    it('judges one rule on its own, even when it is switched off', async () => {
      const { owner } = await households();
      const first = await addCategory(db.em(), owner, 'First');
      const second = await addCategory(db.em(), owner, 'Second');
      await addRule(owner, owner.appuser, [{ categoryId: first.categoryKey, type: 'set_category' }], { stopProcessing: true });
      const later = await addRule(owner, owner.appuser, [{ categoryId: second.categoryKey, type: 'set_category' }], { active: false });
      const payment = await netflixPayment(owner);

      await applyNow(scopeOf(owner, owner.appuser, later));

      expect(await categoryOf(payment)).toBe(second.categoryKey);
    });

    it('runs every active rule in order when applying them all', async () => {
      const { owner } = await households();
      const first = await addCategory(db.em(), owner, 'First');
      const second = await addCategory(db.em(), owner, 'Second');
      const off = await addCategory(db.em(), owner, 'Off');
      await addRule(owner, owner.appuser, [{ categoryId: first.categoryKey, type: 'set_category' }]);
      await addRule(owner, owner.appuser, [{ categoryId: second.categoryKey, type: 'set_category' }, { type: 'mark_reviewed' }]);
      await addRule(owner, owner.appuser, [{ categoryId: off.categoryKey, type: 'set_category' }], { active: false });
      const payment = await netflixPayment(owner);
      const scope = scopeOf(owner, owner.appuser, null);

      expect(await countRuleRun(db.em(), scope)).toBe(1);
      expect(await applyNow(scope)).toMatchObject({ changed: 1 });

      expect(await categoryOf(payment)).toBe(second.categoryKey);
      expect(await reload(payment)).toMatchObject({ reviewed: true });
      expect(await countRuleRun(db.em(), scope)).toBe(0);
    });
  });

  describe('scoping', () => {
    it('never counts or changes another household\'s transactions', async () => {
      const { neighbour, owner } = await households();
      const rule = await addRule(owner, owner.appuser, [{ type: 'hide' }]);
      const theirs = await netflixPayment(neighbour);
      await netflixPayment(owner);
      const scope = scopeOf(owner, owner.appuser, rule);

      expect(await countRuleRun(db.em(), scope)).toBe(1);
      expect(await applyNow(scope)).toMatchObject({ changed: 1, total: 1 });
      expect(await reload(theirs)).toMatchObject({ hidden: false });
    });

    it('refuses another household\'s rule', async () => {
      const { neighbour, owner } = await households();
      const theirRule = await addRule(neighbour, neighbour.appuser, [{ type: 'hide' }]);
      const scope = scopeOf(owner, owner.appuser, theirRule);

      await expect(countRuleRun(db.em(), scope)).rejects.toMatchObject({ status: 404 });
      await expect(startRuleRun(db.em(), scope, { enqueue: enqueue() })).rejects.toMatchObject({ status: 404 });
    });

    it('acts only on what both the rule\'s owner and the member applying it can see', async () => {
      const { owner, ownersPrivate, partner, partnersPrivate } = await households();
      const ownersRule = await addRule(owner, owner.appuser, [{ type: 'hide' }]);
      const shared = await netflixPayment(owner);
      const ownerPrivateRow = await netflixPayment(owner, { account: ownersPrivate });
      const partnerPrivateRow = await netflixPayment(owner, { account: partnersPrivate, appuser: partner });

      // The partner applying the owner's rule: the owner's private account is out of the
      // partner's sight, and the partner's is out of the rule's.
      const asPartner = scopeOf(owner, partner, ownersRule);
      expect(await countRuleRun(db.em(), asPartner)).toBe(1);
      expect(await applyNow(asPartner)).toMatchObject({ changed: 1, total: 2 });
      expect(await reload(shared)).toMatchObject({ hidden: true });
      expect(await reload(ownerPrivateRow)).toMatchObject({ hidden: false });
      expect(await reload(partnerPrivateRow)).toMatchObject({ hidden: false });

      const asOwner = scopeOf(owner, owner.appuser, ownersRule);
      expect(await countRuleRun(db.em(), asOwner)).toBe(1);
      expect(await applyNow(asOwner)).toMatchObject({ changed: 1 });
      expect(await reload(ownerPrivateRow)).toMatchObject({ hidden: true });
      expect(await reload(partnerPrivateRow)).toMatchObject({ hidden: false });
    });
  });

  describe('running in the background', () => {
    it('records who started it and refuses a second run while one is in progress', async () => {
      const { owner, partner } = await households();
      const rule = await addRule(owner, owner.appuser, [{ type: 'hide' }]);
      const queue = enqueue();

      const { operationId } = await startRuleRun(db.em(), scopeOf(owner, owner.appuser, rule), { enqueue: queue });

      expect(queue.send).toHaveBeenCalledOnce();
      expect(await operation(operationId)).toMatchObject({ appuserKey: { appuserKey: owner.appuser.appuserKey }, queueJobId: 'job-1', status: BackgroundOperationStatus.QUEUED, tenantKey: { tenantKey: owner.tenant.tenantKey } });
      await expect(startRuleRun(db.em(), scopeOf(owner, partner, null), { enqueue: enqueue() })).rejects.toMatchObject({ code: 'rule_apply_in_progress', status: 409 });

      await runRuleRun(db.em(), operationId, 'job-1');
      await expect(startRuleRun(db.em(), scopeOf(owner, partner, null), { enqueue: enqueue() })).resolves.toMatchObject({ operationId: expect.any(String) });
    });

    it('reports its progress batch by batch and finishes as succeeded', async () => {
      const { owner } = await households();
      const rule = await addRule(owner, owner.appuser, [{ type: 'hide' }]);
      for (let index = 0; index < 5; index++) await netflixPayment(owner);
      const { operationId } = await startRuleRun(db.em(), scopeOf(owner, owner.appuser, rule), { enqueue: enqueue() });
      const seen: RuleRunProgress[] = [];

      await runRuleRun(db.em(), operationId, 'job-1', { afterBatch: async () => { seen.push(await progressOf(operationId)); }, batchSize: 2 });

      expect(seen.map((progress) => progress.processed)).toEqual([2, 4, 5]);
      expect(await operation(operationId)).toMatchObject({ progress: { changed: 5, processed: 5, ruleKey: rule.ruleKey, total: 5 }, status: BackgroundOperationStatus.SUCCEEDED });
    });

    it('carries on from the last committed batch after the worker stops part-way', async () => {
      const { owner } = await households();
      const streaming = await addCategory(db.em(), owner, 'Streaming');
      const rule = await addRule(owner, owner.appuser, [{ categoryId: streaming.categoryKey, type: 'set_category' }]);
      const payments: Transaction[] = [];
      for (let index = 0; index < 5; index++) payments.push(await netflixPayment(owner));
      const scope = scopeOf(owner, owner.appuser, rule);
      const counted = await countRuleRun(db.em(), scope);
      const { operationId } = await startRuleRun(db.em(), scope, { enqueue: enqueue() });

      const crash = new Error('worker stopped');
      await expect(runRuleRun(db.em(), operationId, 'job-1', { afterBatch: () => Promise.reject(crash), batchSize: 2 })).rejects.toBe(crash);
      expect(await operation(operationId)).toMatchObject({ progress: { changed: 2, processed: 2 }, status: BackgroundOperationStatus.RUNNING });

      // pg-boss hands the same job back once the dead worker's job expires.
      await runRuleRun(db.em(), operationId, 'job-1', { batchSize: 2 });

      expect(await operation(operationId)).toMatchObject({ progress: { changed: counted, processed: 5, total: 5 }, status: BackgroundOperationStatus.SUCCEEDED });
      for (const payment of payments) expect(await categoryOf(payment)).toBe(streaming.categoryKey);
      expect(await db.em().count(TransactionAuditLog, {}, { filters: false })).toBe(5);
    });

    it('fails without changing anything when its rule was deleted before it ran', async () => {
      const { owner } = await households();
      const rule = await addRule(owner, owner.appuser, [{ type: 'hide' }]);
      const payment = await netflixPayment(owner);
      const { operationId } = await startRuleRun(db.em(), scopeOf(owner, owner.appuser, rule), { enqueue: enqueue() });
      const em = db.em();
      (await em.findOneOrFail(Rule, { ruleKey: rule.ruleKey })).deletedAt = new Date();
      await em.flush();

      await runRuleRun(db.em(), operationId, 'job-1');

      expect(await operation(operationId)).toMatchObject({ errorCode: 'rule.apply:rule-not-found', status: BackgroundOperationStatus.FAILED });
      expect(await reload(payment)).toMatchObject({ hidden: false });
    });
  });
});
