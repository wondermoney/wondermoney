import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

// One switch to make the engine throw, for the "a failing rule never fails a sync" case.
const engineFault = vi.hoisted(() => ({ on: false }));
vi.mock('@service/rules/rule-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@service/rules/rule-engine')>();
  return {
    ...actual,
    evaluateRules: (...args: Parameters<typeof actual.evaluateRules>) => {
      if (engineFault.on) throw new Error('engine fault');
      return actual.evaluateRules(...args);
    },
  };
});

import { addAccount, addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import type { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { AppuserMerchantCategory, Source as MappingSource } from '@entity/AppuserMerchantCategory';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { Rule, RuleMatchMode } from '@entity/Rule';
import { Tag } from '@entity/Tag';
import { CategorizationConfidence, Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionEnrichment } from '@entity/TransactionEnrichment';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionTag } from '@entity/TransactionTag';
import { TransactionType } from '@entity/TransactionType';
import syncService, { type BankSyncTransaction } from '@service/account/account-initial-sync-transaction.service';
import { connectionRef as conn, providerFromClient } from '@service/bank-providers/__tests__/helpers';
import type { Enqueue } from '@service/queue/enqueue';
import type { RuleAction, RuleCondition } from '@service/rules/rule-schema';
import { TransactionImportService, type TransactionImportStorage } from '@service/transaction-import/transaction-import.service';
import { applyUserCategorization } from '@service/transaction/user-categorization.service';

/*
 * A household's rules run on every transaction that arrives by bank sync or file import, before
 * learned categorization: a rule's category wins over a learned merchant mapping, and a
 * transaction a rule categorized is never sent to AI enrichment. Rules run once, when the row is
 * created: a re-sync never re-applies them, so it cannot undo what the user changed since. A
 * rule acts only on transactions its owner can see, and a failing rule never fails the sync or
 * import that brought the transactions in.
 */
describe('rules on new transactions', () => {
  const db = useTestDatabase();
  let position = 0;

  beforeEach(() => {
    engineFault.on = false;
  });

  const netflix: RuleCondition = { field: 'merchant', operator: 'contains', value: 'netflix' };

  async function addRule(household: Household, owner: Appuser | null, actions: RuleAction[], conditions: RuleCondition[] = [netflix]): Promise<Rule> {
    const em = db.em();
    const rule = em.create(Rule, { actions, active: true, conditions, match: RuleMatchMode.ALL, name: `Rule ${position}`, ownerAppuserKey: owner, position: position++, stopProcessing: false, tenantKey: household.tenant, version: 1 }, { partial: true });
    await em.flush();
    return rule;
  }

  /** A category both the rules (household) and learned categorization (member) can assign. */
  async function category(household: Household, name: string): Promise<Category> {
    const em = db.em();
    const created = em.create(Category, { appuserKey: household.appuser, bgColor: '#000', isSystemCategory: false, name, tenantKey: household.tenant, textColor: '#fff' }, { partial: true });
    await em.flush();
    return created;
  }

  /** The member has taught WonderMoney that this merchant is `learned`. */
  async function learnMapping(household: Household, merchantName: string, learned: Category): Promise<void> {
    const em = db.em();
    const merchant = (await em.findOne(TransactionMerchant, { name: merchantName }, { filters: false })) ?? em.create(TransactionMerchant, { name: merchantName, normalizedName: merchantName.toLowerCase(), tenantKey: household.tenant }, { partial: true });
    em.create(AppuserMerchantCategory, { appuserKey: household.appuser, categoryKey: learned, source: MappingSource.USER, transactionMerchantKey: merchant }, { partial: true });
    await em.flush();
  }

  const categoryOf = async (transaction: Pick<Transaction, 'transactionKey'>) => (await db.em().find(AppuserTransactionCategory, { transactionKey: { transactionKey: transaction.transactionKey } }, { filters: false, populate: ['categoryKey'] }));

  const ruleAudits = (transaction: Pick<Transaction, 'transactionKey'>) => db.em().find(TransactionAuditLog, { source: 'rule', transactionKey: { transactionKey: transaction.transactionKey } }, { filters: false });

  async function storedRows(account?: Account): Promise<Transaction[]> {
    return db.em().find(Transaction, account ? { accountKey: account } : {}, { filters: false, orderBy: { transactionKey: 'ASC' }, populate: ['transactionMerchantKey'] });
  }

  describe('bank sync', () => {
    async function linkedHousehold(household?: Household) {
      const em = db.em();
      const owner = household ?? (await seedHousehold(em));
      for (const name of ['DEPOSIT', 'PAYMENT', 'CARD_PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT']) {
        if (!(await em.findOne(TransactionType, { name }))) em.create(TransactionType, { displayName: name, name }, { partial: true });
      }
      const credential = em.create(EnableBankingCredential, { applicationId: `app-${owner.appuser.appuserKey}`, appuserKey: owner.appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'tag', privateKeyCiphertext: 'cipher', privateKeyIv: 'iv', tenantKey: owner.tenant }, { partial: true });
      const connection = em.create(EnableBankingConnection, { accessValidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), appuserKey: owner.appuser, aspspCountry: 'PT', aspspName: 'Bank', enableBankingCredentialKey: credential, sessionId: `session-${owner.appuser.appuserKey}`, state: `state-${owner.appuser.appuserKey}`, status: EnableBankingConnectionStatus.LINKED, tenantKey: owner.tenant }, { partial: true });
      await em.flush();
      return { connection, owner };
    }

    async function linkAccount(connection: EnableBankingConnection, account: Account, accountId: string) {
      const em = db.em();
      const managed = await em.findOneOrFail(EnableBankingConnection, { enableBankingConnectionKey: connection.enableBankingConnectionKey }, { filters: false });
      account.accountId = accountId;
      account.enableBankingConnectionKey = managed;
      await em.upsert(account);
    }

    const debit = (entryReference: string, creditorName: string, amount = '12.99'): BankSyncTransaction => ({ bookingDate: '2026-07-10', creditDebitIndicator: 'debit', creditorName, entryReference, remittanceInformationUnstructured: creditorName, transactionAmount: { amount: `-${amount}`, currency: 'EUR' } });

    function sync(connection: EnableBankingConnection, feed: Record<string, BankSyncTransaction[]>) {
      const client = { account: (accountId: string) => ({ getTransactions: () => Promise.resolve({ transactions: { booked: feed[accountId] ?? [], pending: [] } }) }) };
      return syncService.syncTransactionsForRequisition({ connection: conn(connection.enableBankingConnectionKey, { appuserId: connection.appuserKey.appuserKey }), fetchWindowDays: 3650 }, { em: db.em(), provider: providerFromClient(client) });
    }

    async function syncedHousehold() {
      const { connection, owner } = await linkedHousehold();
      await linkAccount(connection, owner.account, 'acc-current');
      return { connection, owner };
    }

    it('categorizes a synced transaction by the rule, with a high-confidence rule reason and an audit entry naming the rule', async () => {
      const { connection, owner } = await syncedHousehold();
      const streaming = await category(owner, 'Streaming');
      const rule = await addRule(owner, owner.appuser, [{ categoryId: streaming.categoryKey, type: 'set_category' }]);

      await expect(sync(connection, { 'acc-current': [debit('n-1', 'Netflix')] })).resolves.toMatchObject({ status: 'completed', transactionsCreated: 1 });

      const [row] = await storedRows();
      expect(row).toMatchObject({ categorizationConfidence: CategorizationConfidence.HIGH, categorizationReason: `rule:${rule.ruleKey}` });
      expect(await categoryOf(row!)).toEqual([expect.objectContaining({ categoryKey: expect.objectContaining({ categoryKey: streaming.categoryKey }), source: Source.RULE })]);
      expect(await ruleAudits(row!)).toEqual([expect.objectContaining({ actorType: TransactionAuditActorType.SYSTEM, changes: expect.objectContaining({ ruleKeys: { from: null, to: [rule.ruleKey] } }), eventType: TransactionAuditEventType.CATEGORIZED })]);
    });

    it('still categorizes by the learned merchant mapping when no rule matches', async () => {
      const { connection, owner } = await syncedHousehold();
      const learned = await category(owner, 'Learned');
      await learnMapping(owner, 'Netflix', learned);
      await addRule(owner, owner.appuser, [{ type: 'hide' }], [{ field: 'merchant', operator: 'contains', value: 'spotify' }]);

      await sync(connection, { 'acc-current': [debit('n-1', 'Netflix')] });

      const [row] = await storedRows();
      expect(await categoryOf(row!)).toEqual([expect.objectContaining({ categoryKey: expect.objectContaining({ categoryKey: learned.categoryKey }), source: Source.DETERMINISTIC })]);
    });

    it('lets a rule\'s category win over the learned merchant mapping', async () => {
      const { connection, owner } = await syncedHousehold();
      const learned = await category(owner, 'Learned');
      const streaming = await category(owner, 'Streaming');
      await learnMapping(owner, 'Netflix', learned);
      await addRule(owner, owner.appuser, [{ categoryId: streaming.categoryKey, type: 'set_category' }]);

      await sync(connection, { 'acc-current': [debit('n-1', 'Netflix')] });

      const [row] = await storedRows();
      expect(await categoryOf(row!)).toEqual([expect.objectContaining({ categoryKey: expect.objectContaining({ categoryKey: streaming.categoryKey }), source: Source.RULE })]);
    });

    it('looks up the learned mapping by the description a rule gave the transaction', async () => {
      const { connection, owner } = await syncedHousehold();
      const learned = await category(owner, 'Streaming');
      await learnMapping(owner, 'Netflix', learned);
      await addRule(owner, owner.appuser, [{ type: 'set_description', value: 'Netflix' }], [{ field: 'merchant', operator: 'contains', value: 'nflx' }]);

      await sync(connection, { 'acc-current': [debit('n-1', 'NFLX DIGITAL')] });

      const [row] = await storedRows();
      expect(row).toMatchObject({ description: 'Netflix' });
      expect(await categoryOf(row!)).toEqual([expect.objectContaining({ categoryKey: expect.objectContaining({ categoryKey: learned.categoryKey }), source: Source.DETERMINISTIC })]);
    });

    it('does not apply rules again on a re-sync, so a category the user changed since stays', async () => {
      const { connection, owner } = await syncedHousehold();
      const streaming = await category(owner, 'Streaming');
      const chosen = await category(owner, 'Chosen');
      await addRule(owner, owner.appuser, [{ categoryId: streaming.categoryKey, type: 'set_category' }, { type: 'set_notes', value: 'from a rule' }]);
      const feed = { 'acc-current': [debit('n-1', 'Netflix')] };
      await sync(connection, feed);
      const [row] = await storedRows();
      const em = db.em();
      const managed = await em.findOneOrFail(Transaction, { transactionKey: row!.transactionKey }, { filters: false, populate: ['appuserTransactionCategories'] });
      await applyUserCategorization(em, { actor: owner.appuser, category: chosen, transactions: [managed] });
      await em.nativeUpdate(Transaction, { transactionKey: row!.transactionKey }, { notes: null });

      await expect(sync(connection, feed)).resolves.toMatchObject({ transactionsCreated: 0 });

      expect(await categoryOf(row!)).toEqual([expect.objectContaining({ categoryKey: expect.objectContaining({ categoryKey: chosen.categoryKey }) })]);
      expect((await storedRows())[0]).toMatchObject({ notes: null });
      expect(await ruleAudits(row!)).toHaveLength(1);
    });

    it('runs the rules on every new row of a sync, and on the rows a later sync brings', async () => {
      const { connection, owner } = await syncedHousehold();
      const tag = db.em().create(Tag, { color: '#94a3b8', name: 'Subscriptions', tenantKey: owner.tenant }, { partial: true });
      await db.em().persist(tag).flush();
      await addRule(owner, owner.appuser, [{ tagIds: [tag.tagKey], type: 'add_tags' }]);

      await sync(connection, { 'acc-current': [debit('n-1', 'Netflix'), debit('s-1', 'Spotify'), debit('n-2', 'Netflix', '15.99')] });
      await sync(connection, { 'acc-current': [debit('n-1', 'Netflix'), debit('s-1', 'Spotify'), debit('n-2', 'Netflix', '15.99'), debit('n-3', 'Netflix', '17.99')] });

      const rows = await storedRows();
      const tagged = await db.em().find(TransactionTag, { tagKey: tag }, { filters: false });
      expect(tagged.map((link) => link.transactionKey.transactionKey).sort((a, b) => a - b)).toEqual(rows.filter((row) => row.transactionMerchantKey?.name === 'Netflix').map((row) => row.transactionKey));
      expect(tagged).toHaveLength(3);
    });

    it('never applies the partner\'s rule to a row synced into the owner\'s private account, nor another household\'s rule', async () => {
      const { connection, owner } = await syncedHousehold();
      const partner = await addPartner(db.em(), owner);
      const privateAccount = await addAccount(db.em(), owner, { isPrivate: true });
      await linkAccount(connection, privateAccount, 'acc-private');
      const neighbour = await seedHousehold(db.em());
      await addRule(owner, partner, [{ type: 'set_notes', value: 'partner rule' }]);
      await addRule(neighbour, neighbour.appuser, [{ type: 'hide' }]);

      await sync(connection, { 'acc-current': [debit('n-1', 'Netflix')], 'acc-private': [debit('n-2', 'Netflix', '15.99')] });

      const [shared] = await storedRows(owner.account);
      const [secret] = await storedRows(privateAccount);
      expect(shared).toMatchObject({ hidden: false, notes: 'partner rule' });
      expect(secret).toMatchObject({ hidden: false, notes: null });
      expect(await ruleAudits(secret!)).toEqual([]);
    });

    it('skips a stored rule that is no longer valid and still applies the others', async () => {
      const { connection, owner } = await syncedHousehold();
      await addRule(owner, owner.appuser, [{ type: 'hide' }], [{ field: 'amount', operator: 'between' } as unknown as RuleCondition]);
      await addRule(owner, owner.appuser, [{ type: 'set_notes', value: 'still ran' }]);

      await expect(sync(connection, { 'acc-current': [debit('n-1', 'Netflix')] })).resolves.toMatchObject({ status: 'completed', transactionsCreated: 1 });

      expect((await storedRows())[0]).toMatchObject({ hidden: false, notes: 'still ran' });
    });

    it('completes the sync, with learned categorization, when applying the rules fails', async () => {
      const { connection, owner } = await syncedHousehold();
      const learned = await category(owner, 'Learned');
      await learnMapping(owner, 'Netflix', learned);
      await addRule(owner, owner.appuser, [{ type: 'set_notes', value: 'never written' }]);
      engineFault.on = true;

      await expect(sync(connection, { 'acc-current': [debit('n-1', 'Netflix')] })).resolves.toMatchObject({ status: 'completed', transactionsCreated: 1 });

      const [row] = await storedRows();
      expect(row).toMatchObject({ notes: null });
      expect(await categoryOf(row!)).toEqual([expect.objectContaining({ categoryKey: expect.objectContaining({ categoryKey: learned.categoryKey }) })]);
    });

    it('leaves a rule-categorized transaction out of AI enrichment', async () => {
      const { connection, owner } = await syncedHousehold();
      const streaming = await category(owner, 'Streaming');
      await addRule(owner, owner.appuser, [{ categoryId: streaming.categoryKey, type: 'set_category' }]);
      await sync(connection, { 'acc-current': [debit('n-1', 'Netflix'), debit('s-1', 'Spotify')] });
      const { enqueueTransactionEnrichmentForTenant } = await vi.importActual<typeof import('@service/transaction-enrichment/transaction-enrichment-enqueue.service')>('@service/transaction-enrichment/transaction-enrichment-enqueue.service');
      const enqueue = { send: vi.fn().mockResolvedValue('job'), sendAfter: vi.fn().mockResolvedValue('job') };
      const config = { dailyTenantBudget: 100, enabled: true, expirationSeconds: 60, mode: 'shadow' as const, modelVersion: 'model', promptVersion: 'prompt', retentionSeconds: 60, retryDelaySeconds: 1, retryLimit: 1, writeConfidenceThreshold: 0.9 };

      await enqueueTransactionEnrichmentForTenant(owner.tenant.tenantKey, 'account-initial-sync', { config, em: db.em(), enqueue });

      const enriched = await db.em().find(TransactionEnrichment, {}, { filters: false, populate: ['transactionKey.transactionMerchantKey'] });
      expect(enriched.map((row) => row.transactionKey.transactionMerchantKey?.name)).toEqual(['Spotify']);
    });
  });

  describe('file import', () => {
    let household: Household;

    beforeEach(async () => {
      const em = db.em();
      household = await seedHousehold(em);
      for (const name of ['CARD_PAYMENT', 'DEPOSIT', 'PAYMENT']) {
        if (!(await em.findOne(TransactionType, { name }))) em.create(TransactionType, { displayName: name, name }, { partial: true });
      }
      await em.flush();
    });

    /** A staged import of `text`, read and committed as the worker does, reporting what it did. */
    async function importFile(text: string, format: 'generic-csv' | 'statement' = 'statement') {
      const objects = new Map<string, Buffer>();
      const storage: TransactionImportStorage = {
        getAccountCsvBucketName: () => 'bucket',
        getObjectBuffer: (_bucket, key) => {
          const object = objects.get(key);
          return object ? Promise.resolve(object) : Promise.reject(new Error('NoSuchKey'));
        },
        getObjectSize: (_bucket, key) => Promise.resolve(objects.get(key)?.length),
        presignAccountUpload: (accountKey) => Promise.resolve({ key: `account-${accountKey}-import-${objects.size + 1}.csv`, presignedUrl: 'https://files.example.test/upload' }),
      };
      const sent: { data: { correlationId: string; mode: 'commit' | 'parse' }; queue: string }[] = [];
      const enqueue: Enqueue = {
        send: (queue, data) => {
          sent.push({ data: data as (typeof sent)[number]['data'], queue });
          return Promise.resolve(`job-${sent.length}`);
        },
        sendAfter: () => Promise.resolve(null),
      };
      const service = () => new TransactionImportService(DI.em.fork(), { enqueue, storage });
      const runLastJob = () => {
        const index = sent.length - 1;
        const job = sent[index];
        if (!job) throw new Error('no job queued');
        return service().run(job.data.correlationId, `job-${index + 1}`, job.data.mode);
      };
      const key = `account-${household.account.accountKey}-import-${objects.size + 1}.csv`;
      objects.set(key, Buffer.from(text, 'utf8'));
      const scope = { appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey };
      const created = await service().create(scope, {
        accountId: household.account.accountKey,
        format,
        key,
        ...(format === 'statement' ? { options: { mapping: { columns: { amount: 2, date: 0, description: 1 }, dateFormat: 'YMD' as const, decimalSeparator: ',', headerRowIndex: 0, invertAmounts: false } } } : {}),
      });
      await runLastJob();
      await service().commit(scope, created.id);
      await runLastJob();
      const view = await service().get(scope, created.id, {});
      return { failed: view.session.counts.failed + view.session.counts.invalid, imported: view.session.counts.imported, skipped: view.session.counts.skipped };
    }

    const statement = ['date;description;amount', '2026-09-02;NETFLIX.COM;-12,99', '2026-09-03;CONTINENTE MATOSINHOS;-42,50'].join('\n');

    it('categorizes an imported row by the rule, over the learned mapping, and leaves the rest to learned categorization', async () => {
      const learned = await category(household, 'Learned');
      const groceries = await category(household, 'Groceries');
      const streaming = await category(household, 'Streaming');
      await learnMapping(household, 'NETFLIX.COM', learned);
      await learnMapping(household, 'CONTINENTE MATOSINHOS', groceries);
      const rule = await addRule(household, household.appuser, [{ categoryId: streaming.categoryKey, type: 'set_category' }]);

      await expect(importFile(statement)).resolves.toMatchObject({ failed: 0, imported: 2 });

      const [netflixRow, groceriesRow] = await storedRows();
      expect(netflixRow).toMatchObject({ categorizationConfidence: CategorizationConfidence.HIGH, categorizationReason: `rule:${rule.ruleKey}` });
      expect(await categoryOf(netflixRow!)).toEqual([expect.objectContaining({ categoryKey: expect.objectContaining({ categoryKey: streaming.categoryKey }), source: Source.RULE })]);
      expect(await categoryOf(groceriesRow!)).toEqual([expect.objectContaining({ categoryKey: expect.objectContaining({ categoryKey: groceries.categoryKey }), source: Source.DETERMINISTIC })]);
      expect(await ruleAudits(netflixRow!)).toHaveLength(1);
      expect(await ruleAudits(groceriesRow!)).toEqual([]);
    });

    it('does not apply rules to the rows a re-import skips', async () => {
      await addRule(household, household.appuser, [{ type: 'set_notes', value: 'from a rule' }]);
      await importFile(statement);
      const [row] = await storedRows();
      await db.em().nativeUpdate(Transaction, { transactionKey: row!.transactionKey }, { notes: 'mine' });

      await expect(importFile(statement)).resolves.toMatchObject({ imported: 0, skipped: 2 });

      expect((await storedRows())[0]).toMatchObject({ notes: 'mine' });
      expect(await ruleAudits(row!)).toHaveLength(1);
    });

    it('imports every row when applying the rules fails', async () => {
      await addRule(household, household.appuser, [{ type: 'set_notes', value: 'never written' }]);
      engineFault.on = true;

      await expect(importFile(statement)).resolves.toMatchObject({ failed: 0, imported: 2 });

      expect((await storedRows()).map((row) => row.notes ?? null)).toEqual([null, null]);
    });

    it('runs the rules on rows of the generic CSV template', async () => {
      const cardPayment = await db.em().findOneOrFail(TransactionType, { name: 'CARD_PAYMENT' });
      await addRule(household, household.appuser, [{ type: 'set_notes', value: 'from a rule' }]);
      const text = ['date,amount,merchant,internalTransactionId,transactionTypeKey,description', `2026-09-01,12.99,Netflix,generic-1,${cardPayment.transactionTypeKey},`, `2026-09-02,40,Continente,generic-2,${cardPayment.transactionTypeKey},`].join('\n');

      await expect(importFile(text, 'generic-csv')).resolves.toMatchObject({ failed: 0, imported: 2 });

      expect((await storedRows()).map((row) => [row.transactionMerchantKey?.name, row.notes ?? null])).toEqual([['Netflix', 'from a rule'], ['Continente', null]]);
    });
  });
});
