import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';

import type { EntityManager } from '@mikro-orm/postgresql';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { addAccount, addCategory, addMerchant, addPartner, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import type { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { AppuserMerchantCategory, Source } from '@entity/AppuserMerchantCategory';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Goal } from '@entity/Goal';
import { GoalAccountLink } from '@entity/GoalAccountLink';
import { GoalActivity, GoalActivityType } from '@entity/GoalActivity';
import { GoalTransactionFunding } from '@entity/GoalTransactionFunding';
import { Loan } from '@entity/Loan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { ManualAsset } from '@entity/ManualAsset';
import { ManualAssetValuation } from '@entity/ManualAssetValuation';
import { Portfolio, PortfolioAccountBalanceMode } from '@entity/Portfolio';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';
import { Rule } from '@entity/Rule';
import { Tag } from '@entity/Tag';
import { Transaction } from '@entity/Transaction';
import { TransactionSplit } from '@entity/TransactionSplit';
import { TransactionTag } from '@entity/TransactionTag';
import { Watchlist } from '@entity/Watchlist';
import { LoanAllocationSource, LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';
import { ManualAssetKind } from '@service/manual-asset/manual-asset-types';

import { type ExportScope, writeHouseholdExport } from '../household-export';

/*
 * A member's export holds what that member can see in their household and nothing else: never
 * another household's rows, never the other member's private accounts or anything hanging off
 * them, and never a credential, token or provider id.
 *
 * Every private row below carries the marker SECRET and every row of the neighbouring household
 * the marker NEIGHBOUR, so a scan of the whole archive catches a leak through any file or field.
 */
describe('household export', () => {
  const db = useTestDatabase();

  interface Archive {
    csv: Record<string, string>;
    data: Record<string, Record<string, unknown>[]>;
    entries: Record<string, Uint8Array>;
    manifest: { exportedBy: { memberId: number }; files: { bytes: number; path: string; rows: number; sha256: string }[]; formatVersion: string; household: { id: number; ownerMemberId: null | number } };
    text: string;
  }

  async function exportFor(scope: ExportScope, deps: Parameters<typeof writeHouseholdExport>[3] = {}): Promise<Archive> {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    await writeHouseholdExport(db.em(), scope, output, { now: () => new Date('2026-11-08T10:00:00Z'), ...deps });
    const entries = unzipSync(new Uint8Array(Buffer.concat(chunks)));
    const archive: Archive = { csv: {}, data: {}, entries, manifest: JSON.parse(strFromU8(entries['manifest.json']!)) as Archive['manifest'], text: '' };
    for (const [path, bytes] of Object.entries(entries)) {
      const text = strFromU8(bytes);
      archive.text += `\n${text}`;
      if (path.startsWith('data/')) archive.data[path.slice(5, -5)] = JSON.parse(text) as Record<string, unknown>[];
      if (path.startsWith('csv/')) archive.csv[path.slice(4, -4)] = text;
    }
    return archive;
  }

  const scopeOf = (household: Household, member: Appuser = household.appuser): ExportScope => ({ appuserKey: member.appuserKey, tenantKey: household.tenant.tenantKey });

  /**
   * The owner's data in every shape the export covers, on `account`. `prefix` marks every row
   * that belongs to the account, so a scan can find it; the category and tag are household-wide,
   * so they carry it in lower case.
   */
  async function populate(em: EntityManager, household: Household, account: Account, prefix: string) {
    const category = await addCategory(em, household, `category-${prefix.toLowerCase()}`);
    const merchant = await addMerchant(em, household, `${prefix}-MERCHANT`);
    const transaction = await addTransaction(em, household, { account, amount: -42.5, date: new Date('2026-07-11T12:00:00Z'), merchant, status: 'BOOKED' });
    transaction.notes = `${prefix}-NOTE`;
    transaction.description = `${prefix}-DESCRIPTION`;
    const tag = em.create(Tag, { color: '#123456', name: `tag-${prefix.toLowerCase()}`, tenantKey: household.tenant }, { partial: true });
    em.create(TransactionTag, { tagKey: tag, tenantKey: household.tenant, transactionKey: transaction }, { partial: true });
    em.create(TransactionSplit, { amount: -40, categoryKey: category, notes: `${prefix}-SPLIT`, position: 0, tenantKey: household.tenant, transactionKey: transaction }, { partial: true });
    em.create(TransactionSplit, { amount: -2.5, notes: `${prefix}-SPLIT`, position: 1, tenantKey: household.tenant, transactionKey: transaction }, { partial: true });
    const series = em.create(RecurringSeries, { accountKey: account, displayName: `${prefix}-SERIES`, normalizedMerchantKey: `${prefix.toLowerCase()}-series`, tenantKey: household.tenant }, { partial: true });
    em.create(RecurringOccurrence, { amount: -42.5, occurrenceDate: new Date('2026-07-11T12:00:00Z'), recurringSeriesKey: series, transactionKey: transaction }, { partial: true });
    em.create(Rule, { actions: [{ categoryId: category.categoryKey, type: 'set_category' }], conditions: [{ field: 'account', operator: 'in', values: [account.accountKey] }], name: `${prefix}-RULE`, position: await nextRulePosition(em, household), tenantKey: household.tenant }, { partial: true });
    await em.flush();
    return { category, merchant, series, tag, transaction };
  }

  async function nextRulePosition(em: EntityManager, household: Household): Promise<number> {
    return em.count(Rule, { tenantKey: household.tenant }, { filters: false });
  }

  /** Owner with a private account full of data, partner, and a neighbouring household. */
  async function households() {
    const em = db.em();
    const owner = await seedHousehold(em);
    const partner = await addPartner(em, owner);
    const sharedAccount = owner.account;
    sharedAccount.accountName = 'Joint current account';
    sharedAccount.accountId = 'PROVIDER-ACCOUNT-ID-shared';
    const privateAccount = await addAccount(em, owner, { isPrivate: true, name: 'SECRET-ACCOUNT' });
    privateAccount.accountId = 'PROVIDER-ACCOUNT-ID-private';

    const shared = await populate(em, owner, sharedAccount, 'SHARED');
    shared.transaction.enableBankingTransactionId = 'EB-TRANSACTION-ID-shared';
    const secret = await populate(em, owner, privateAccount, 'SECRET');
    const partnerOwn = await addTransaction(em, owner, { amount: -9, appuser: partner, date: new Date('2026-07-12T12:00:00Z'), status: 'BOOKED' });
    partnerOwn.description = 'Partner coffee';

    // Household-wide rows linked to the private account: the row stays, the link does not.
    const goal = em.create(Goal, { appuserKey: owner.appuser, currencyKey: owner.currency, name: 'Holiday', targetAmount: 1000, tenantKey: owner.tenant }, { partial: true });
    em.create(GoalAccountLink, { accountKey: sharedAccount, goalKey: goal, tenantKey: owner.tenant }, { partial: true });
    em.create(GoalAccountLink, { accountKey: privateAccount, goalKey: goal, tenantKey: owner.tenant }, { partial: true });
    em.create(GoalTransactionFunding, { amount: 42.5, currencyKey: owner.currency, goalKey: goal, tenantKey: owner.tenant, transactionKey: shared.transaction }, { partial: true });
    em.create(GoalTransactionFunding, { amount: 42.5, currencyKey: owner.currency, goalKey: goal, tenantKey: owner.tenant, transactionKey: secret.transaction }, { partial: true });
    em.create(GoalActivity, { amount: 10, appuserKey: owner.appuser, goalKey: goal, tenantKey: owner.tenant, transactionKey: secret.transaction, type: GoalActivityType.ASSIGNED }, { partial: true });
    const budget = em.create(Budget, { appuserKey: owner.appuser, currencyKey: owner.currency, name: 'Home', numAdults: 2, numDependents: 0, tenantKey: owner.tenant }, { partial: true });
    const line = em.create(BudgetTemplateCategory, { amountBudgeted: 300, budgetKey: budget, categoryKey: shared.category, month: 7, year: 2026 }, { partial: true });
    line.accounts.add([sharedAccount, privateAccount]);
    const portfolio = em.create(Portfolio, { accountBalanceMode: PortfolioAccountBalanceMode.INCLUDES_HOLDINGS, currencyKey: owner.currency, linkedAccountKey: privateAccount, name: 'Shares', portfolioOwnerAppuserKey: owner.appuser, tenantKey: owner.tenant }, { partial: true });

    // The owner's loan is personal: the partner never sees it.
    const loan = em.create(Loan, { currencyKey: owner.currency, name: 'OWNER-LOAN', openingBalanceDate: new Date('2026-01-01'), openingPrincipalBalance: 5000, ownerAppuserKey: owner.appuser, paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.FIXED, status: LoanStatus.ACTIVE, tenantKey: owner.tenant, type: LoanType.PERSONAL_LOAN }, { partial: true });
    em.create(LoanRepaymentLink, { allocationSource: LoanAllocationSource.MANUAL, feeAmount: 0, interestAmount: 2.5, linkedByAppuserKey: owner.appuser, loanKey: loan, paymentDate: new Date('2026-07-11'), principalAmount: 40, tenantKey: owner.tenant, totalPaymentAmount: 42.5, transactionKey: secret.transaction }, { partial: true });
    em.create(Watchlist, { appuserKey: owner.appuser, symbol: 'OWNERWATCH', tenantKey: owner.tenant }, { partial: true });
    em.create(AppuserMerchantCategory, { appuserKey: owner.appuser, categoryKey: secret.category, source: Source.MANUAL, transactionMerchantKey: secret.merchant }, { partial: true });

    // A shared home with two valuations, and a watch only the owner knows about.
    const home = em.create(ManualAsset, { currencyKey: owner.currency, growthAnnualRatePercent: 2.5, isPrivate: false, kind: ManualAssetKind.PROPERTY, name: 'SHARED-HOME', ownerAppuserKey: owner.appuser, purchaseDate: new Date('2020-03-01'), purchasePrice: 180_000, tenantKey: owner.tenant }, { partial: true });
    em.create(ManualAssetValuation, { manualAssetKey: home, tenantKey: owner.tenant, valuationDate: new Date('2020-03-01'), value: 180_000 }, { partial: true });
    em.create(ManualAssetValuation, { manualAssetKey: home, note: 'SHARED-ESTIMATE', tenantKey: owner.tenant, valuationDate: new Date('2026-05-10'), value: 240_000.5 }, { partial: true });
    const watch = em.create(ManualAsset, { currencyKey: owner.currency, isPrivate: true, kind: ManualAssetKind.VALUABLE, name: 'SECRET-WATCH', ownerAppuserKey: owner.appuser, tenantKey: owner.tenant }, { partial: true });
    em.create(ManualAssetValuation, { manualAssetKey: watch, note: 'SECRET-APPRAISAL', tenantKey: owner.tenant, valuationDate: new Date('2026-02-01'), value: 4000 }, { partial: true });
    const sold = em.create(ManualAsset, { currencyKey: owner.currency, deletedAt: new Date(), isPrivate: false, kind: ManualAssetKind.VEHICLE, name: 'DELETED-CAR', ownerAppuserKey: owner.appuser, tenantKey: owner.tenant }, { partial: true });
    em.create(ManualAssetValuation, { manualAssetKey: sold, tenantKey: owner.tenant, valuationDate: new Date('2026-02-01'), value: 1 }, { partial: true });
    em.create(ManualAssetValuation, { deletedAt: new Date(), manualAssetKey: home, note: 'DELETED-VALUATION', tenantKey: owner.tenant, valuationDate: new Date('2026-03-01'), value: 2 }, { partial: true });

    // Bank credentials and connection tokens.
    const credential = em.create(EnableBankingCredential, { applicationId: 'EB-APPLICATION-ID', appuserKey: owner.appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'EB-AUTH-TAG', privateKeyCiphertext: 'EB-PRIVATE-KEY-CIPHERTEXT', privateKeyIv: 'EB-PRIVATE-KEY-IV', tenantKey: owner.tenant }, { partial: true });
    const connection = em.create(EnableBankingConnection, { appuserKey: owner.appuser, aspspCountry: 'PT', aspspName: 'Bank', authorizationId: 'EB-AUTHORIZATION-ID', enableBankingCredentialKey: credential, sessionId: 'EB-SESSION-ID', state: 'EB-STATE-TOKEN', tenantKey: owner.tenant }, { partial: true });
    sharedAccount.enableBankingConnectionKey = connection;

    const neighbour = await seedHousehold(em);
    neighbour.account.accountName = 'NEIGHBOUR-ACCOUNT';
    await populate(em, neighbour, neighbour.account, 'NEIGHBOUR');
    em.create(Goal, { appuserKey: neighbour.appuser, currencyKey: neighbour.currency, name: 'NEIGHBOUR-GOAL', targetAmount: 1, tenantKey: neighbour.tenant }, { partial: true });
    em.create(Budget, { appuserKey: neighbour.appuser, currencyKey: neighbour.currency, name: 'NEIGHBOUR-BUDGET', numAdults: 1, numDependents: 0, tenantKey: neighbour.tenant }, { partial: true });
    em.create(Portfolio, { currencyKey: neighbour.currency, name: 'NEIGHBOUR-PORTFOLIO', portfolioOwnerAppuserKey: neighbour.appuser, tenantKey: neighbour.tenant }, { partial: true });
    const flat = em.create(ManualAsset, { currencyKey: neighbour.currency, isPrivate: false, kind: ManualAssetKind.PROPERTY, name: 'NEIGHBOUR-FLAT', ownerAppuserKey: neighbour.appuser, tenantKey: neighbour.tenant }, { partial: true });
    em.create(ManualAssetValuation, { manualAssetKey: flat, note: 'NEIGHBOUR-ESTIMATE', tenantKey: neighbour.tenant, valuationDate: new Date('2026-02-01'), value: 90_000 }, { partial: true });
    await em.flush();

    const externalIds = (await em.find(Appuser, {}, { filters: false })).map((user) => user.externalUserId);
    return { externalIds, goal, neighbour, owner, partner, partnerOwn, portfolio, privateAccount, secret, shared, sharedAccount };
  }

  describe("the other member's private account", () => {
    it('leaves out the account and everything that hangs off it', async () => {
      const { owner, partner } = await households();

      const archive = await exportFor(scopeOf(owner, partner));

      expect(archive.text).not.toContain('SECRET');
      expect(archive.data['accounts']!.map((row) => row['name'])).toEqual(['Joint current account']);
      expect(archive.data['transactions']!.map((row) => row['description']).sort()).toEqual(['Partner coffee', 'SHARED-DESCRIPTION']);
      expect(archive.data['transaction-splits']).toHaveLength(2);
      expect(archive.data['transaction-tags']).toHaveLength(1);
      expect(archive.data['recurring-series']!.map((row) => row['displayName'])).toEqual(['SHARED-SERIES']);
      expect(archive.data['recurring-occurrences']).toHaveLength(1);
      expect(archive.data['rules']!.map((row) => row['name'])).toEqual(['SHARED-RULE']);
      expect(archive.data['goal-transaction-fundings']).toHaveLength(1);
    });

    it('keeps household rows that link to it, without the link', async () => {
      const { owner, partner } = await households();

      const archive = await exportFor(scopeOf(owner, partner));

      const [joint] = archive.data['accounts']!;
      expect(archive.data['goals']!.map((row) => row['name'])).toEqual(['Holiday']);
      expect(archive.data['goal-account-links']).toEqual([{ accountId: joint!['id'], goalId: 1 }]);
      expect(archive.data['goal-activities']!.map((row) => row['transactionId'])).toEqual([null]);
      expect(archive.data['budget-categories']!.map((row) => row['accountIds'])).toEqual([[joint!['id']]]);
      expect(archive.data['portfolios']).toEqual([expect.objectContaining({ accountBalanceMode: null, linkedAccountId: null, name: 'Shares' })]);
    });

    it("is all there in its owner's export", async () => {
      const { owner } = await households();

      const archive = await exportFor(scopeOf(owner));

      expect(archive.data['accounts']!.map((row) => row['name'])).toEqual(['Joint current account', 'SECRET-ACCOUNT']);
      expect(archive.data['transactions']!.map((row) => row['description'])).toEqual(expect.arrayContaining(['SECRET-DESCRIPTION', 'SHARED-DESCRIPTION', 'Partner coffee']));
      expect(archive.data['rules']!.map((row) => row['name'])).toEqual(['SHARED-RULE', 'SECRET-RULE']);
      expect(archive.data['transaction-splits']).toHaveLength(4);
      expect(archive.data['goal-transaction-fundings']).toHaveLength(2);
      expect(archive.data['loan-repayments']).toHaveLength(1);
      expect(archive.data['merchant-categories']).toHaveLength(1);
      expect(archive.data['portfolios']).toEqual([expect.objectContaining({ accountBalanceMode: 'includes_holdings', linkedAccountId: 2 })]);
    });
  });

  it("leaves out the other member's personal loans and watchlist", async () => {
    const { owner, partner } = await households();

    const archive = await exportFor(scopeOf(owner, partner));

    expect(archive.text).not.toContain('OWNER-LOAN');
    expect(archive.text).not.toContain('OWNERWATCH');
    expect(archive.data['loans']).toEqual([]);
    expect(archive.data['loan-repayments']).toEqual([]);
    expect(archive.data['watchlist']).toEqual([]);
  });

  describe('manual assets', () => {
    it('holds the shared assets and the member\'s own private ones, each with its live valuations', async () => {
      const { owner } = await households();

      const archive = await exportFor(scopeOf(owner));

      expect(archive.data['manual-assets']).toEqual([
        expect.objectContaining({ archivedAt: null, currency: 'EUR', growthAnnualRatePercent: '2.5', growthStartDate: null, id: 1, isPrivate: false, kind: 'property', name: 'SHARED-HOME', ownerMemberId: 1, purchaseDate: '2020-03-01', purchasePrice: '180000' }),
        expect.objectContaining({ id: 2, isPrivate: true, kind: 'valuable', name: 'SECRET-WATCH', purchasePrice: null }),
      ]);
      expect(archive.data['manual-asset-valuations']).toEqual([
        { date: '2020-03-01', manualAssetId: 1, note: null, value: '180000' },
        { date: '2026-05-10', manualAssetId: 1, note: 'SHARED-ESTIMATE', value: '240000.5' },
        { date: '2026-02-01', manualAssetId: 2, note: 'SECRET-APPRAISAL', value: '4000' },
      ]);
      expect(archive.text).not.toContain('DELETED');
    });

    it("leaves the other member's private asset and its valuations out", async () => {
      const { owner, partner } = await households();

      const archive = await exportFor(scopeOf(owner, partner));

      expect(archive.data['manual-assets']!.map((row) => row['name'])).toEqual(['SHARED-HOME']);
      expect(archive.data['manual-asset-valuations']).toHaveLength(2);
      expect(archive.text).not.toContain('SECRET-WATCH');
      expect(archive.text).not.toContain('SECRET-APPRAISAL');
      // The shared home is the owner's: the partner's export names them as its owner, not the partner.
      expect(archive.data['manual-assets']![0]!['ownerMemberId']).toBe(2);
    });
  });

  it("never holds another household's rows", async () => {
    const { neighbour, owner, partner } = await households();

    for (const scope of [scopeOf(owner), scopeOf(owner, partner)]) {
      expect((await exportFor(scope)).text.toUpperCase()).not.toContain('NEIGHBOUR');
    }
    const theirs = await exportFor(scopeOf(neighbour));
    expect(theirs.text.toUpperCase()).not.toContain('SHARED');
    expect(theirs.text.toUpperCase()).not.toContain('SECRET');
    expect(theirs.data['accounts']!.map((row) => row['name'])).toEqual(['NEIGHBOUR-ACCOUNT']);
  });

  it('refuses a member of another household', async () => {
    const { neighbour, owner } = await households();

    await expect(exportFor({ appuserKey: neighbour.appuser.appuserKey, tenantKey: owner.tenant.tenantKey })).rejects.toThrow('does not belong');
  });

  it('holds no credential, token, provider id or auth identifier', async () => {
    const { externalIds, owner } = await households();

    const archive = await exportFor(scopeOf(owner));

    for (const secret of ['PROVIDER-ACCOUNT-ID', 'EB-TRANSACTION-ID', 'EB-APPLICATION-ID', 'EB-AUTH-TAG', 'EB-PRIVATE-KEY', 'EB-AUTHORIZATION-ID', 'EB-SESSION-ID', 'EB-STATE-TOKEN', 'internal-', ...externalIds]) {
      expect(archive.text).not.toContain(secret);
    }
    // A formerly bank-linked account says so, without the connection.
    expect(archive.data['accounts']![0]).toEqual(expect.objectContaining({ bankLinked: true, name: 'Joint current account' }));
    expect(archive.data['transactions']!.find((row) => row['description'] === 'SHARED-DESCRIPTION')).toEqual(expect.objectContaining({ bankSynced: true }));
  });

  it('shows the other member by first name and role only', async () => {
    const { owner, partner } = await households();

    const archive = await exportFor(scopeOf(owner, partner));

    expect(archive.manifest.exportedBy.memberId).toBe(1);
    expect(archive.data['members']).toEqual([
      expect.objectContaining({ email: partner.emailAddress, id: 1, isExporter: true }),
      { email: null, firstName: 'Owner', id: 2, isExporter: false, lastName: null, role: 'owner' },
    ]);
    expect(archive.manifest.household.ownerMemberId).toBe(2);
    expect(archive.text).not.toContain(owner.appuser.emailAddress);
  });

  describe('format', () => {
    it('lists every file with its row count and SHA-256 in the manifest', async () => {
      const { owner } = await households();

      const archive = await exportFor(scopeOf(owner));

      expect(archive.manifest.formatVersion).toBe('1.2');
      const paths = Object.keys(archive.entries).filter((path) => path !== 'manifest.json').sort();
      expect(archive.manifest.files.map((file) => file.path).sort()).toEqual(paths);
      for (const file of archive.manifest.files) {
        const bytes = archive.entries[file.path]!;
        expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
        expect(file.bytes).toBe(bytes.length);
        const rows = file.path.endsWith('.json') ? archive.data[file.path.slice(5, -5)]!.length : archive.csv[file.path.slice(4, -4)]!.trim().split('\n').length - 1;
        expect(file.rows).toBe(rows);
      }
    });

    it('refers between files by export-local ids, never database keys', async () => {
      const { owner } = await households();

      const archive = await exportFor(scopeOf(owner));

      const transaction = archive.data['transactions']!.find((row) => row['description'] === 'SECRET-DESCRIPTION')!;
      const account = archive.data['accounts']!.find((row) => row['id'] === transaction['accountId'])!;
      expect(account['name']).toBe('SECRET-ACCOUNT');
      const merchant = archive.data['merchants']!.find((row) => row['id'] === transaction['merchantId'])!;
      expect(merchant['name']).toBe('SECRET-MERCHANT');
      const splits = archive.data['transaction-splits']!.filter((row) => row['transactionId'] === transaction['id']);
      const category = archive.data['categories']!.find((row) => row['id'] === splits[0]!['categoryId'])!;
      expect(category['name']).toBe('category-secret');
      const rule = archive.data['rules']!.find((row) => row['name'] === 'SECRET-RULE')!;
      expect(rule['conditions']).toEqual([{ field: 'account', operator: 'in', values: [account['id']] }]);
      expect(rule['actions']).toEqual([{ categoryId: category['id'], type: 'set_category' }]);
      expect(Object.keys(transaction)).not.toContain('transactionKey');
    });

    it('writes amounts as exact decimals and dates as ISO strings, in JSON and CSV', async () => {
      const { owner } = await households();

      const archive = await exportFor(scopeOf(owner));

      const transaction = archive.data['transactions']!.find((row) => row['description'] === 'SHARED-DESCRIPTION')!;
      expect(transaction).toEqual(expect.objectContaining({ date: '2026-07-11T12:00:00.000Z', settlementAmount: '-42.5', settlementCurrency: 'EUR' }));
      const lines = archive.csv['transactions']!.replace(/^\ufeff/u, '').trim().split('\n');
      expect(lines[0]).toBe('id,date,account,description,merchant,category,tags,amount,currency,original_amount,original_currency,type,status,notes,hidden');
      const row = lines.find((line) => line.includes('SHARED-DESCRIPTION'))!.split(',');
      expect(row[1]).toBe('2026-07-11');
      expect(row[5]).toBe('category-shared | ');
      expect(row[6]).toBe('tag-shared');
      expect(row[7]).toBe('-42.5');
    });

    it('writes portfolio transactions with assets by symbol and holdings from the portfolio service', async () => {
      const em = db.em();
      const owner = await seedHousehold(em);
      const { asset, portfolio } = await seedPortfolio(em, owner);
      const buy = await em.findOneOrFail(FinancialTransactionType, { financialTransactionTypeKey: FINANCIAL_TRANSACTION_TYPES.BUY });
      asset.isin = 'US0378331005';
      em.create(FinancialTransaction, { appuserKey: owner.appuser, financialAssetKey: asset, financialTransactionTypeKey: buy, internalTransactionId: 'internal-ft-1', portfolioKey: portfolio, quantity: 3, settlementAmount: 450.75, settlementCurrencyKey: owner.currency, settlementUnitAmount: 150.25, tenantKey: owner.tenant, transactionDate: new Date('2026-03-02T00:00:00Z') }, { partial: true });
      await em.flush();

      const archive = await exportFor(scopeOf(owner), {
        holdings: ({ portfolioKey }) => Promise.resolve(portfolioKey === portfolio.portfolioKey ? [{ averageBuyPrice: 150.25, currency: 'EUR', currentPrice: 160, currentValue: 480, financialAssetName: 'Apple', financialAssetSymbol: 'AAPL', financialAssetType: 'Stock', quantity: 3 }] : []),
      });

      expect(archive.data['portfolio-transactions']).toEqual([expect.objectContaining({ asset: expect.objectContaining({ isin: 'US0378331005', symbol: 'AAPL' }), portfolioId: 1, quantity: '3', settlementAmount: '450.75', type: 'BUY' })]);
      expect(archive.text).not.toContain('internal-ft-1');
      expect(archive.csv['holdings']!.replace(/^\ufeff/u, '').trim().split('\n')).toEqual([
        'portfolio,symbol,asset,asset_type,quantity,average_buy_price,current_price,current_value,currency',
        'Shares,AAPL,Apple,Stock,3,150.25,160,480,EUR',
      ]);
    });

    it('streams a household larger than one read batch', async () => {
      const em = db.em();
      const owner = await seedHousehold(em);
      for (let index = 0; index < 1205; index += 1) {
        em.create(Transaction, { accountKey: owner.account, appuserKey: owner.appuser, description: `Row ${index}`, settlementAmount: -1, settlementCurrencyKey: owner.currency, tenantKey: owner.tenant, transactionDate: new Date('2026-01-01T00:00:00Z'), transactionStatusKey: owner.statuses.BOOKED }, { partial: true });
      }
      await em.flush();

      const archive = await exportFor(scopeOf(owner));

      const ids = archive.data['transactions']!.map((row) => row['id']);
      expect(ids).toHaveLength(1205);
      expect(new Set(ids).size).toBe(1205);
      expect(archive.manifest.files.find((file) => file.path === 'csv/transactions.csv')!.rows).toBe(1205);
    });
  });

});
