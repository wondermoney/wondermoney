/**
 * Minimal household + transaction rows for tests that run against `pg-test-db.ts`.
 *
 * Every helper persists through a real EntityManager and flushes, so the rows are in the database
 * before the code under test reads them.
 */
import { randomUUID } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';

import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant, HouseholdRole } from '@entity/AppuserTenant';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { Currency } from '@entity/Currency';
import { Tenant } from '@entity/Tenant';
import { TenantStatus } from '@entity/TenantStatus';
import { Transaction } from '@entity/Transaction';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionStatus } from '@entity/TransactionStatus';
import { TransactionType } from '@entity/TransactionType';

export interface Household {
  account: Account;
  appuser: Appuser;
  currency: Currency;
  statuses: Record<StatusName, TransactionStatus>;
  tenant: Tenant;
  types: { cardPayment: TransactionType; income: TransactionType };
}

export type StatusName = 'BOOKED' | 'EXPIRED' | 'PENDING';

let sequence = 0;
const next = () => ++sequence;

export interface TransactionInput {
  account?: Account;
  amount: number;
  /** Defaults to the household owner. */
  appuser?: Appuser;
  /** Running balance in the user's currency, for net-worth history. */
  appuserCurrencyBalance?: number;
  category?: Category;
  date: Date;
  /** Marks the row as bank-synced, the way the Enable Banking sync stores it. */
  enableBankingTransactionId?: string;
  hidden?: boolean;
  merchant?: TransactionMerchant;
  /** `null` stores a row with no status, as legacy rows may have. */
  status: null | StatusName;
  type?: TransactionType;
}

export async function addCategory(em: EntityManager, household: Household, name: string, parent?: Category): Promise<Category> {
  const category = em.create(Category, { bgColor: '#000', isSystemCategory: false, name, parentCategory: parent, tenantKey: household.tenant, textColor: '#fff' }, { partial: true });
  await em.flush();
  return category;
}

export async function addMerchant(em: EntityManager, household: Household, name: string): Promise<TransactionMerchant> {
  const merchant = em.create(TransactionMerchant, { name, normalizedName: name.toLowerCase(), tenantKey: household.tenant }, { partial: true });
  await em.flush();
  return merchant;
}

export async function addTransaction(em: EntityManager, household: Household, input: TransactionInput): Promise<Transaction> {
  const key = next();
  const transaction = em.create(Transaction, {
    accountKey: input.account ?? household.account,
    appuserCurrencyBalance: input.appuserCurrencyBalance,
    appuserCurrencyKey: household.currency,
    appuserKey: input.appuser ?? household.appuser,
    appuserSettlementAmount: input.amount,
    balance: input.appuserCurrencyBalance,
    description: input.merchant?.name ?? `Transaction ${key}`,
    enableBankingTransactionId: input.enableBankingTransactionId,
    hidden: input.hidden ?? false,
    internalTransactionId: `internal-${key}`,
    originalAmount: input.amount,
    originalCurrencyKey: household.currency,
    settlementAmount: input.amount,
    settlementCurrencyKey: household.currency,
    tenantKey: household.tenant,
    transactionDate: input.date,
    transactionMerchantKey: input.merchant,
    transactionStatusKey: input.status ? household.statuses[input.status] : undefined,
    transactionTypeKey: input.type ?? (input.amount >= 0 ? household.types.income : household.types.cardPayment),
  }, { partial: true });
  if (input.category) {
    em.create(AppuserTransactionCategory, { appuserKey: input.appuser ?? household.appuser, categoryKey: input.category, source: Source.USER, transactionKey: transaction }, { partial: true });
  }
  await em.flush();
  return transaction;
}

export async function seedHousehold(em: EntityManager): Promise<Household> {
  // Reference rows are shared: a test that seeds two households (to prove one cannot see the
  // other) reuses the currency, statuses and types the first one created.
  const currency = (await em.findOne(Currency, { code: 'EUR' })) ?? em.create(Currency, { code: 'EUR', num: '978' }, { partial: true });
  const status = async (name: StatusName) => (await em.findOne(TransactionStatus, { name })) ?? em.create(TransactionStatus, { name }, { partial: true });
  const type = async (name: string, displayName: string) => (await em.findOne(TransactionType, { name })) ?? em.create(TransactionType, { displayName, name }, { partial: true });
  const statuses = { BOOKED: await status('BOOKED'), EXPIRED: await status('EXPIRED'), PENDING: await status('PENDING') };
  const types = { cardPayment: await type('card_payment', 'Card payment'), income: await type('income', 'Income') };
  const tenantStatus = em.create(TenantStatus, { description: `active-${next()}` }, { partial: true });
  const appuser = em.create(Appuser, { currencyKey: currency, emailAddress: `owner${next()}@example.test`, externalUserId: randomUUID(), firstName: 'Owner' }, { partial: true });
  const tenant = em.create(Tenant, { ownerAppuserKey: appuser, tentantStatusKey: tenantStatus }, { partial: true });
  em.create(AppuserTenant, { appuserKey: appuser, recordActive: true, tenantKey: tenant }, { partial: true });
  const account = em.create(Account, { accountName: 'Current account', accountOwnerAppuserKey: appuser, balance: 1000, closed: false, currencyKey: currency, isPrivate: false, tenantKey: tenant }, { partial: true });
  await em.flush();
  return { account, appuser, currency, statuses, tenant, types };
}

/** Add a second, invited member to a household. */
export async function addPartner(em: EntityManager, household: Household): Promise<Appuser> {
  const partner = em.create(Appuser, { currencyKey: household.currency, emailAddress: `partner${next()}@example.test`, externalUserId: randomUUID(), firstName: 'Partner' }, { partial: true });
  em.create(AppuserTenant, { appuserKey: partner, recordActive: true, role: HouseholdRole.MEMBER, tenantKey: household.tenant }, { partial: true });
  await em.flush();
  return partner;
}

/** An account in the household, owned by `owner` (default: the household owner). */
export async function addAccount(em: EntityManager, household: Household, input: { balance?: number; isPrivate?: boolean; name?: string; owner?: Appuser } = {}): Promise<Account> {
  const account = em.create(Account, {
    accountName: input.name ?? `Account ${next()}`,
    accountOwnerAppuserKey: input.owner ?? household.appuser,
    balance: input.balance ?? 0,
    closed: false,
    currencyKey: household.currency,
    isPrivate: input.isPrivate ?? false,
    tenantKey: household.tenant,
  }, { partial: true });
  await em.flush();
  return account;
}

/** One row per status the rule distinguishes, all on the same day, so a test can see which ones count. */
export const ONE_OF_EACH_STATUS: (null | StatusName)[] = ['BOOKED', 'PENDING', 'EXPIRED', null];
