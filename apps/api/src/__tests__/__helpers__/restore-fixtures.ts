/**
 * Households for restore tests, on the real-Postgres harness (`pg-test-db.ts`): one holding a row
 * of every kind the export covers, an empty one to restore into, and helpers to export a household
 * and to count what a household holds.
 */
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';

import type { EntityManager } from '@mikro-orm/postgresql';
import { strFromU8, unzipSync } from 'fflate';

import { addAccount, addCategory, addMerchant, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { addAssetPrice, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';
import { AccountType } from '@entity/AccountType';
import { Appuser } from '@entity/Appuser';
import { AppuserAccountPosition } from '@entity/AppuserAccountPosition';
import { AppuserMerchantCategory, Source as MerchantSource } from '@entity/AppuserMerchantCategory';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { BudgetTemplateIncome } from '@entity/BudgetTemplateIncome';
import { Category } from '@entity/Category';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { CryptoWalletAddress } from '@entity/CryptoWalletAddress';
import { CryptoWalletToken } from '@entity/CryptoWalletToken';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { EnableBankingCredential } from '@entity/EnableBankingCredential';
import { ExchangeRateOverride } from '@entity/ExchangeRateOverride';
import { FinancialAssetPriceOverride } from '@entity/FinancialAssetPriceOverride';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Goal } from '@entity/Goal';
import { GoalAccountLink } from '@entity/GoalAccountLink';
import { GoalActivity, GoalActivityType } from '@entity/GoalActivity';
import { GoalTransactionFunding } from '@entity/GoalTransactionFunding';
import { Installment } from '@entity/Installment';
import { InstallmentPlan } from '@entity/InstallmentPlan';
import { Loan } from '@entity/Loan';
import { LoanAdjustment } from '@entity/LoanAdjustment';
import { LoanRatePeriod } from '@entity/LoanRatePeriod';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { ManualAsset } from '@entity/ManualAsset';
import { ManualAssetValuation } from '@entity/ManualAssetValuation';
import { PortfolioAccountBalanceMode } from '@entity/Portfolio';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';
import { Rule } from '@entity/Rule';
import { Tag } from '@entity/Tag';
import { Tenant } from '@entity/Tenant';
import { TenantCategorySetting } from '@entity/TenantCategorySetting';
import { TenantStatus } from '@entity/TenantStatus';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionReimbursement } from '@entity/TransactionReimbursement';
import { TransactionSplit } from '@entity/TransactionSplit';
import { TransactionTag } from '@entity/TransactionTag';
import { TransactionTemplate, TransactionTemplateDirection } from '@entity/TransactionTemplate';
import { TransactionType } from '@entity/TransactionType';
import { Watchlist } from '@entity/Watchlist';
import { writeHouseholdExport } from '@service/data-export/household-export';
import { buildInstallmentSchedule } from '@service/installment/installment-schedule';
import { LoanAdjustmentType, LoanAllocationSource, LoanAmortizationMethod, LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';
import { ManualAssetKind } from '@service/manual-asset/manual-asset-types';

export interface Scope {
  appuserKey: number;
  tenantKey: number;
}

export const scopeOf = (household: { appuser: Appuser; tenant: Tenant }): Scope => ({ appuserKey: household.appuser.appuserKey, tenantKey: household.tenant.tenantKey });

/** A new member alone in a new household with nothing in it: where a restore goes. */
export async function emptyHousehold(em: EntityManager, options: { currency?: string } = {}): Promise<{ appuser: Appuser; tenant: Tenant }> {
  const currency = await currencyFor(em, options.currency ?? 'EUR');
  const tenantStatus = em.create(TenantStatus, { description: `active-${randomUUID()}` }, { partial: true });
  const appuser = em.create(Appuser, { currencyKey: currency, emailAddress: `restorer-${randomUUID()}@example.test`, externalUserId: randomUUID(), firstName: 'Restorer' }, { partial: true });
  const tenant = em.create(Tenant, { ownerAppuserKey: appuser, tentantStatusKey: tenantStatus }, { partial: true });
  em.create(AppuserTenant, { appuserKey: appuser, recordActive: true, tenantKey: tenant }, { partial: true });
  await em.flush();
  return { appuser, tenant };
}

/**
 * A household with a row of every kind the export holds, every kind of reference between them, a
 * foreign-currency account and a formerly bank-linked one.
 */
export async function richHousehold(em: EntityManager) {
  const owner = await seedHousehold(em);
  const eur = owner.currency;
  // A portfolio with trades in an asset priced in dollars (this also creates USD).
  const { asset, portfolio, usd } = await seedPortfolio(em, owner);
  const current = owner.account;
  current.accountName = 'Current account';
  current.openingBalance = 1000;
  current.openingBalanceDate = new Date('2026-01-01T00:00:00Z');
  current.balance = 1957.5;
  current.appuserCurrencyBalance = 1957.5;
  const checking = em.create(AccountType, { description: 'CHECKING' }, { partial: true });
  current.accountTypeKey = checking;
  const savings = await addAccount(em, owner, { balance: 5000, isPrivate: true, name: 'Savings' });
  savings.appuserCurrencyBalance = 5000;
  const dollars = await addAccount(em, owner, { balance: 250, currency: usd, name: 'Dollar account' });

  // A system category (global) with a household child, and a household tree of its own.
  const groceries = em.create(Category, { bgColor: '#111111', isSystemCategory: true, name: 'Groceries', textColor: '#ffffff' }, { partial: true });
  await em.flush();
  const organic = await addCategory(em, owner, 'Organic', groceries);
  const home = await addCategory(em, owner, 'Home');
  const rent = await addCategory(em, owner, 'Rent', home);
  em.create(TenantCategorySetting, { categoryKey: groceries, countsAsSpending: false, tenantKey: owner.tenant }, { partial: true });

  const shop = await addMerchant(em, owner, 'Corner Shop');
  shop.website = 'https://corner-shop.example.com';
  shop.logoUrl = 'https://cdn.example.com/corner-shop.png';
  const globalMerchant = em.create(TransactionMerchant, { name: 'Global Mart', normalizedName: 'global mart' }, { partial: true });
  em.create(AppuserMerchantCategory, { appuserKey: owner.appuser, categoryKey: organic, source: MerchantSource.MANUAL, transactionMerchantKey: shop }, { partial: true });
  const tag = em.create(Tag, { color: '#123456', createdByAppuserKey: owner.appuser, name: 'holiday', tenantKey: owner.tenant }, { partial: true });

  const salary = await addTransaction(em, owner, { amount: 2000, appuserCurrencyBalance: 3000, category: home, date: new Date('2026-02-01T09:00:00Z'), status: 'BOOKED' });
  salary.balance = 3000;
  const groceryRun = await addTransaction(em, owner, { amount: -42.5, appuserCurrencyBalance: 2957.5, category: organic, date: new Date('2026-02-03T18:30:00Z'), merchant: shop, status: 'BOOKED' });
  groceryRun.notes = 'weekly shop';
  groceryRun.balance = 2957.5;
  const globalRun = await addTransaction(em, owner, { amount: -10, date: new Date('2026-02-04T10:00:00Z'), merchant: globalMerchant, status: 'PENDING' });
  em.create(TransactionSplit, { amount: -40, categoryKey: organic, notes: 'food', position: 0, tenantKey: owner.tenant, transactionKey: groceryRun }, { partial: true });
  em.create(TransactionSplit, { amount: -2.5, notes: 'bag', position: 1, tenantKey: owner.tenant, transactionKey: groceryRun }, { partial: true });
  em.create(TransactionTag, { tagKey: tag, tenantKey: owner.tenant, transactionKey: groceryRun }, { partial: true });
  // Part of the salary reimburses the pending purchase (a refund linked to the expense it offsets).
  em.create(TransactionReimbursement, { amount: 7.5, expenseTransactionKey: globalRun, linkedByAppuserKey: owner.appuser, reimbursementTransactionKey: salary, tenantKey: owner.tenant }, { partial: true });

  // A transfer between two accounts, each side pointing at the other.
  const transferType = (await em.findOne(TransactionType, { name: 'TRANSFER_OUT' })) ?? em.create(TransactionType, { displayName: 'Transfer out', name: 'TRANSFER_OUT' }, { partial: true });
  const out = await addTransaction(em, owner, { amount: -1000, appuserCurrencyBalance: 1957.5, date: new Date('2026-02-05T08:00:00Z'), status: 'BOOKED', type: transferType });
  out.balance = 1957.5;
  const into = await addTransaction(em, owner, { account: savings, amount: 1000, appuserCurrencyBalance: 5000, date: new Date('2026-02-05T08:00:00Z'), status: 'BOOKED' });
  into.balance = 5000;
  out.transferCounterpartKey = into;
  into.transferCounterpartKey = out;
  out.transferDestinationAccountKey = savings;
  out.transferExchangeRate = 1.0842;
  into.transferExchangeRate = 1.0842;
  const dollarSpend = await addTransaction(em, owner, { account: dollars, amount: -12, currency: usd, date: new Date('2026-02-06T08:00:00Z'), status: 'BOOKED' });
  dollarSpend.appuserCurrencyKey = eur;
  dollarSpend.appuserSettlementAmount = -11;
  dollarSpend.appuserCurrencyExchangeRate = 0.9166;

  em.create(Rule, { actions: [{ categoryId: organic.categoryKey, type: 'set_category' }, { tagIds: [tag.tagKey], type: 'add_tags' }], conditions: [{ field: 'account', operator: 'in', values: [current.accountKey] }, { field: 'merchant', operator: 'contains', value: 'corner' }], name: 'Groceries rule', ownerAppuserKey: owner.appuser, position: 0, tenantKey: owner.tenant }, { partial: true });
  em.create(Rule, { actions: [{ merchantId: shop.transactionMerchantKey, type: 'set_merchant' }], conditions: [{ field: 'description', operator: 'contains', source: 'cleaned', value: 'shop' }], name: 'Merchant rule', position: 1, tenantKey: owner.tenant }, { partial: true });

  const series = em.create(RecurringSeries, { accountKey: current, categoryKey: rent, currencyKey: eur, displayName: 'Rent', expectedAmount: -800, normalizedMerchantKey: 'landlord', tenantKey: owner.tenant }, { partial: true });
  em.create(RecurringOccurrence, { amount: -42.5, currencyKey: eur, occurrenceDate: new Date('2026-02-03T18:30:00Z'), recurringSeriesKey: series, transactionKey: groceryRun }, { partial: true });

  const budget = em.create(Budget, { appuserKey: owner.appuser, currencyKey: eur, description: 'Monthly', name: 'Home', numAdults: 2, numDependents: 1, periodStartDay: 25, rolloverCarriesOverspend: false, tenantKey: owner.tenant }, { partial: true });
  const line = em.create(BudgetTemplateCategory, { amountBudgeted: 300, budgetKey: budget, categoryKey: organic, month: 2, rolloverEnabled: true, year: 2026 }, { partial: true });
  line.accounts.add([current, savings]);
  em.create(BudgetTemplateIncome, { amount: 2000, budgetKey: budget, name: 'Salary' }, { partial: true });

  const loan = em.create(Loan, { amortizationMethod: LoanAmortizationMethod.CONSTANT_PRINCIPAL, currencyKey: eur, firstPaymentDate: new Date('2026-02-01'), name: 'Car loan', openingBalanceDate: new Date('2026-01-01'), openingPrincipalBalance: 8000, ownerAppuserKey: owner.appuser, paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.VARIABLE, status: LoanStatus.ACTIVE, tenantKey: owner.tenant, type: LoanType.AUTO_LOAN }, { partial: true });
  em.create(LoanRatePeriod, { annualInterestRateBps: 475, effectiveDate: new Date('2026-04-01'), loanKey: loan, tenantKey: owner.tenant }, { partial: true });
  em.create(LoanAdjustment, { amount: 100, createdByAppuserKey: owner.appuser, effectiveDate: new Date('2026-01-15'), loanKey: loan, reason: 'fee', tenantKey: owner.tenant, type: LoanAdjustmentType.FEE }, { partial: true });
  em.create(LoanRepaymentLink, { allocationSource: LoanAllocationSource.MANUAL, feeAmount: 0, interestAmount: 2.5, linkedByAppuserKey: owner.appuser, loanKey: loan, paymentDate: new Date('2026-02-03'), principalAmount: 40, tenantKey: owner.tenant, totalPaymentAmount: 42.5, transactionKey: groceryRun }, { partial: true });

  const goal = em.create(Goal, { appuserKey: owner.appuser, currencyKey: eur, loanKey: loan, name: 'Holiday', targetAmount: 1500, targetDate: new Date('2026-08-01T00:00:00Z'), tenantKey: owner.tenant }, { partial: true });
  em.create(GoalAccountLink, { accountKey: savings, goalKey: goal, tenantKey: owner.tenant }, { partial: true });
  em.create(GoalActivity, { amount: 50, appuserKey: owner.appuser, currencyKey: eur, goalKey: goal, note: 'first', occurredAt: new Date('2026-02-02T00:00:00Z'), tenantKey: owner.tenant, transactionKey: salary, type: GoalActivityType.ASSIGNED }, { partial: true });
  em.create(GoalTransactionFunding, { amount: 42.5, currencyKey: eur, goalKey: goal, tenantKey: owner.tenant, transactionKey: groceryRun }, { partial: true });
  globalRun.transferDestinationGoalKey = goal;

  // A home bought in dollars with a growth rule and two valuations, and a private car since sold.
  const house = em.create(ManualAsset, { currencyKey: usd, growthAnnualRatePercent: 2.5, growthStartDate: new Date('2026-01-01'), isPrivate: false, kind: ManualAssetKind.PROPERTY, name: 'Home', notes: 'Top floor', ownerAppuserKey: owner.appuser, purchaseDate: new Date('2020-03-01'), purchasePrice: 180_000.5, tenantKey: owner.tenant }, { partial: true });
  em.create(ManualAssetValuation, { manualAssetKey: house, tenantKey: owner.tenant, valuationDate: new Date('2020-03-01'), value: 180_000.5 }, { partial: true });
  em.create(ManualAssetValuation, { manualAssetKey: house, note: 'Agent estimate', tenantKey: owner.tenant, valuationDate: new Date('2026-05-10'), value: 240_000 }, { partial: true });
  const car = em.create(ManualAsset, { archivedAt: new Date('2026-06-01T09:30:00Z'), currencyKey: eur, isPrivate: true, kind: ManualAssetKind.VEHICLE, name: 'Old car', ownerAppuserKey: owner.appuser, tenantKey: owner.tenant }, { partial: true });
  em.create(ManualAssetValuation, { manualAssetKey: car, tenantKey: owner.tenant, valuationDate: new Date('2025-01-15'), value: 7000 }, { partial: true });
  // The car loan financed the car.
  loan.securedAssetKey = car;
  // A crypto wallet: one public Ethereum address holding ETH (counted) and a detected token (not ticked).
  const wallet = em.create(ManualAsset, { currencyKey: usd, isPrivate: false, kind: ManualAssetKind.CRYPTO_WALLET, name: 'Cold wallet', ownerAppuserKey: owner.appuser, tenantKey: owner.tenant }, { partial: true });
  em.create(ManualAssetValuation, { manualAssetKey: wallet, tenantKey: owner.tenant, valuationDate: new Date('2026-06-02'), value: 4500 }, { partial: true });
  const walletAddress = em.create(CryptoWalletAddress, { address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', addressKind: 'address', chain: 'ethereum', label: 'Ledger', manualAssetKey: wallet, tenantKey: owner.tenant }, { partial: true });
  em.create(CryptoWalletToken, { cryptoWalletAddressKey: walletAddress, decimals: 18, manualAssetKey: wallet, name: 'Ether', rawBalance: '1500000000000000000', symbol: 'ETH', tenantKey: owner.tenant, tokenRef: 'native', tracked: true }, { partial: true });
  em.create(CryptoWalletToken, { cryptoWalletAddressKey: walletAddress, decimals: 6, manualAssetKey: wallet, name: 'USD Coin', rawBalance: '250000000', symbol: 'USDC', tenantKey: owner.tenant, tokenRef: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', tracked: false }, { partial: true });

  em.create(Watchlist, { appuserKey: owner.appuser, symbol: 'MSFT', tenantKey: owner.tenant }, { partial: true });
  em.create(EmailNotificationPreference, { appuserKey: owner.appuser, bankSyncAlertsEnabled: false, budgetAlertsEnabled: false, creditCardDueRemindersEnabled: false, weeklyInsightsEnabled: false }, { partial: true });

  // The current account is also a card: its statement closes on the 25th and is due on the 10th.
  em.create(CreditCardDetail, { accountKey: current, creditLimit: 1500, minimumPaymentPercent: 5, paymentDueDay: 10, statementCloseDay: 25, tenantKey: owner.tenant }, { partial: true });
  // A sofa in three installments on it; the grocery run (by hand, here) pays the second.
  const cycle = { paymentDueDay: 10, statementCloseDay: 25 };
  const sofa = em.create(InstallmentPlan, { accountKey: current, categoryKey: home, createdByAppuserKey: owner.appuser, description: 'Sofa', installmentCount: 3, purchaseDate: new Date('2026-01-20T00:00:00Z'), tenantKey: owner.tenant, totalAmount: 300 }, { partial: true });
  for (const row of buildInstallmentSchedule({ cycle, installmentCount: 3, purchaseDate: new Date('2026-01-20T00:00:00Z'), totalAmount: 300 })) em.create(Installment, { ...row, installmentPlanKey: sofa, tenantKey: owner.tenant }, { partial: true });
  groceryRun.installmentPlanKey = sofa;
  groceryRun.installmentNumber = 2;
  // The pending purchase was unlinked from the sofa by hand, so the automatic linker leaves the pair alone.
  globalRun.installmentUnlinkedPlanKey = sofa;
  // The pending purchase counts in the March statement, whatever its date.
  globalRun.statementDateOverride = new Date('2026-03-01');
  // The member's own account order, and a saved entry naming a merchant nothing else reaches.
  em.create(AppuserAccountPosition, { accountKey: savings, appuserKey: owner.appuser, position: 0 }, { partial: true });
  em.create(AppuserAccountPosition, { accountKey: current, appuserKey: owner.appuser, position: 1 }, { partial: true });
  const bakery = await addMerchant(em, owner, 'Bakery');
  em.create(TransactionTemplate, { accountKey: current, amount: 2.5, categoryKey: organic, description: 'Morning bread', direction: TransactionTemplateDirection.OUT, name: 'Bread', notes: 'daily', ownerAppuserKey: owner.appuser, position: 0, tenantKey: owner.tenant, transactionMerchantKey: bakery }, { partial: true });
  // The household's own dollar rate for a day the feed missed.
  em.create(ExchangeRateOverride, { createdByAppuserKey: owner.appuser, date: new Date('2026-02-06T00:00:00Z'), fromCurrency: usd, rate: 0.9166, tenantKey: owner.tenant, toCurrency: eur }, { partial: true });
  await em.flush();

  asset.isin = 'US0378331005';
  portfolio.linkedAccountKey = current;
  portfolio.accountBalanceMode = PortfolioAccountBalanceMode.CASH_ONLY;
  portfolio.targetAllocation = { bonds: 20, equity: 80 };
  portfolio.costBasisMethod = PortfolioCostBasisMethod.AVERAGE;
  const buy = await em.findOneOrFail(FinancialTransactionType, { financialTransactionTypeKey: FINANCIAL_TRANSACTION_TYPES.BUY });
  em.create(FinancialTransaction, { appuserKey: owner.appuser, financialAssetKey: asset, financialTransactionTypeKey: buy, internalTransactionId: randomUUID(), portfolioKey: portfolio, quantity: 3, settlementAmount: 450.75, settlementCurrencyKey: usd, settlementUnitAmount: 150.25, tenantKey: owner.tenant, transactionDate: new Date('2026-03-02T00:00:00Z') }, { partial: true });
  em.create(FinancialTransaction, { appuserKey: owner.appuser, financialAssetKey: asset, financialTransactionTypeKey: buy, internalTransactionId: randomUUID(), portfolioKey: portfolio, quantity: 1, settlementAmount: 160, settlementCurrencyKey: usd, settlementUnitAmount: 160, tenantKey: owner.tenant, transactionDate: new Date('2026-04-02T00:00:00Z') }, { partial: true });
  await em.flush();
  await addAssetPrice(em, asset, '2026-04-02', 170);
  // A price the household set by hand for a day the feed got wrong.
  em.create(FinancialAssetPriceOverride, { createdByAppuserKey: owner.appuser, currencyKey: usd, date: new Date('2026-03-31T00:00:00Z'), financialAssetKey: asset, note: 'broker quote', price: 158.4, tenantKey: owner.tenant }, { partial: true });
  await em.flush();

  return { asset, dollars, goal, owner, portfolio, savings };
}

/** Make `account` look like it was linked to a bank, with a credential and a connection. */
export async function linkToBank(em: EntityManager, household: Household, accountKey: number): Promise<void> {
  const credential = em.create(EnableBankingCredential, { applicationId: 'EB-APP', appuserKey: household.appuser, encryptionKeyVersion: 1, privateKeyAuthTag: 'TAG', privateKeyCiphertext: 'CIPHER', privateKeyIv: 'IV', tenantKey: household.tenant }, { partial: true });
  const connection = em.create(EnableBankingConnection, { appuserKey: household.appuser, aspspCountry: 'PT', aspspName: 'Bank', authorizationId: 'AUTH', enableBankingCredentialKey: credential, sessionId: 'SESSION', state: 'STATE', tenantKey: household.tenant }, { partial: true });
  await em.flush();
  await em.getConnection().execute('update account set enable_banking_connection_key = ? where account_key = ?', [connection.enableBankingConnectionKey, accountKey]);
}

/** The household's export as zip bytes. */
export async function exportBytes(em: EntityManager, scope: Scope, options: { password?: string } = {}): Promise<Uint8Array> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  await writeHouseholdExport(em, scope, output, { now: () => new Date('2026-11-08T10:00:00Z') }, options);
  return new Uint8Array(Buffer.concat(chunks));
}

/** The `data/*.json` files of an unprotected export, parsed. */
export function dataFiles(bytes: Uint8Array): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const [path, content] of Object.entries(unzipSync(bytes))) {
    if (path.startsWith('data/')) out[path.slice(5, -5)] = JSON.parse(strFromU8(content)) as Record<string, unknown>[];
  }
  return out;
}

/** Tables a restore writes, with the column that says which household a row is in. */
const TENANT_TABLES = ['account', 'budget', 'category', 'credit_card_detail', 'exchange_rate_override', 'exchange_rate_override_audit_log', 'financial_asset_price_override', 'financial_transaction', 'goal', 'goal_account_link', 'goal_activity', 'goal_transaction_funding', 'installment', 'installment_plan', 'loan', 'loan_adjustment', 'loan_rate_period', 'loan_repayment_link', 'manual_asset', 'manual_asset_valuation', 'crypto_wallet_address', 'crypto_wallet_token', 'portfolio', 'recurring_series', 'rule', 'tag', 'tenant_category_setting', 'transaction', 'transaction_merchant', 'transaction_reimbursement', 'transaction_split', 'transaction_tag', 'transaction_template', 'watchlist'] as const;

/** How many rows of each household table belong to `tenantKey`. */
export async function householdRowCounts(em: EntityManager, tenantKey: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of TENANT_TABLES) {
    const [row] = await em.getConnection().execute<{ n: number }[]>(`select count(*)::int as n from "${table}" where tenant_key = ?`, [tenantKey]);
    counts[table] = row?.n ?? 0;
  }
  return counts;
}

/** Every row of every household table, by table, for comparing whole databases before and after. */
export async function allRowCounts(em: EntityManager): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of [...TENANT_TABLES, 'appuser_account_position', 'appuser_transaction_category', 'appuser_merchant_category', 'budget_template_category', 'budget_template_income', 'recurring_occurrence', 'financial_asset']) {
    const [row] = await em.getConnection().execute<{ n: number }[]>(`select count(*)::int as n from "${table}"`);
    counts[table] = row?.n ?? 0;
  }
  return counts;
}
