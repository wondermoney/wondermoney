import { UniqueConstraintViolationException } from '@mikro-orm/core';

import { Account } from '@entity/Account';
import { AccountFinancialInstitution, AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { AccountType } from '@entity/AccountType';
import { Currency } from '@entity/Currency';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { buildEnableBankingInstitutionRecordId } from '@utils/enable-banking-institution-id';
import { InternalServerError } from '@utils/errors';
import logger from '@utils/logger';

/**
 * The shape of one entry in Enable Banking's `POST /sessions` response `accounts[]`
 * array (confirmed against https://enablebanking.com/docs/api/reference/) — the ONLY place Enable
 * Banking hands back full account identity (IBAN, holder name, currency, and `uid`, the id used
 * for every later `/accounts/{uid}/...` call). There is no separate "list accounts" or "account
 * details" endpoint to re-fetch this from later, which is why `enable-banking-sync-adapter.ts`'s
 * `getDetails()`/`getMetadata()` read these fields back out of our own `Account` rows instead of
 * calling Enable Banking again — this function is what puts them there in the first place.
 */
export interface CreateInitialEnableBankingAccountsResult {
  accounts: Account[];
  accountsCreated: number;
  accountsSkipped: number;
  /** Earlier connections to the bank whose every account moved to this one, now soft-deleted. */
  connectionsRetired: number;
  skippedReasons: string[];
}

export interface EnableBankingSessionAccount {
  account_id?: { iban?: string };
  /** ISO 20022 cash account type; `CARD` marks a credit card. */
  cash_account_type?: string;
  currency?: string;
  name?: string;
  uid?: string;
}

interface EntityManagerLike {
  count(entityClass: new (...args: never[]) => unknown, where: Record<string, unknown>): Promise<number>;
  create<T>(entityClass: new (...args: never[]) => T, data: Partial<T>): T;
  find<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<T[]>;
  findOne<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<null | T>;
  findOneOrFail<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>): Promise<T>;
  flush(): Promise<void>;
  persist(entity: unknown): { flush(): Promise<void> };
}

const DUPLICATE_ERROR_CODES = new Set(['23505']);

/**
 * Persists `Account` rows from a freshly-linked `EnableBankingConnection`'s session accounts.
 * Two things shape it:
 *
 * 1. This runs from `enableBankingCallback`, an **unauthenticated** provider redirect with no
 *    `req.user`/`req.tenant` — identity comes from `connection.appuserKey`/`.tenantKey` (the
 *    values `startBankConnection` captured at link-start time) instead.
 * 2. Enable Banking's session account (`uid`/`account_id.iban`/`name`/`currency`) carries no
 *    balance and no institution id of its own — the institution is the connection's own
 *    `aspspName`/`aspspCountry` (one connection == one bank), and balances are fetched later by
 *    the initial-sync job this function's caller enqueues, not here.
 *
 * Best-effort per account: a single account with an unresolvable currency is skipped (logged),
 * not fatal to the whole batch: there is no HTTP response to fail, and letting the rest of the
 * bank's accounts link is strictly better than aborting all of them over one bad row.
 *
 * **Reconnecting.** Renewing a consent means a brand-new connection and session, and the bank may
 * give every account a new `uid`. Before creating an account, a session account with an IBAN is
 * matched to an existing *active* account of the same owner, household, bank and currency, so the
 * user keeps the account row and its history (see {@link findReconnectedAccount}). An earlier
 * connection whose every account moved over is then soft-deleted, so the connections list does not
 * keep showing the old consent with a "Reconnect" action.
 */
export async function createInitialEnableBankingAccounts(
  em: EntityManagerLike,
  connection: EnableBankingConnection,
  sessionAccounts: unknown[],
): Promise<CreateInitialEnableBankingAccountsResult> {
  if (!connection.tenantKey) {
    throw new InternalServerError('Enable Banking connection is missing tenant ownership; refusing to create accounts without a tenant');
  }
  const tenantKey = connection.tenantKey;

  const institutionId = buildEnableBankingInstitutionRecordId({ country: connection.aspspCountry, name: connection.aspspName });
  let institution = await em.findOne(AccountFinancialInstitution, { deletedAt: undefined, id: institutionId });
  if (!institution) {
    institution = em.create(AccountFinancialInstitution, {
      displayName: connection.aspspName,
      id: institutionId,
      name: connection.aspspName,
      provider: AccountFinancialInstitutionProvider.ENABLE_BANKING,
    });
    try {
      await em.persist(institution).flush();
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      institution = await em.findOneOrFail(AccountFinancialInstitution, { deletedAt: undefined, id: institutionId });
    }
  }

  const accounts: Account[] = [];
  const skippedReasons: string[] = [];
  const claimedAccountKeys = new Set<number>();
  const previousConnectionKeys = new Set<number>();

  for (const raw of sessionAccounts) {
    const sessionAccount = raw as EnableBankingSessionAccount;
    const accountId = sessionAccount.uid;
    if (!accountId) {
      skippedReasons.push('missing uid');
      logger.warn({}, 'Enable Banking session account missing uid — skipping');
      continue;
    }

    const currencyCode = sessionAccount.currency;
    const currency = currencyCode ? await em.findOne(Currency, { code: currencyCode }) : null;
    if (!currency) {
      skippedReasons.push(`unresolvable currency for ${accountId}`);
      logger.warn({ accountId, currencyCode }, 'Enable Banking session account has no resolvable currency — skipping');
      continue;
    }

    // Soft-delete revival + accountId/owner keying, then the reconnect match by IBAN.
    const existingDeleted = await em.findOne(Account, { accountId, accountOwnerAppuserKey: connection.appuserKey, deletedAt: { $ne: null } });
    const existingActive = existingDeleted
      ?? await em.findOne(Account, { accountId, accountOwnerAppuserKey: connection.appuserKey, deletedAt: undefined })
      ?? await findReconnectedAccount(em, { claimedAccountKeys, connection, currency, iban: sessionAccount.account_id?.iban, institution, tenantKey });
    const previousConnectionKey = existingActive?.enableBankingConnectionKey?.enableBankingConnectionKey;
    if (previousConnectionKey !== undefined && previousConnectionKey !== connection.enableBankingConnectionKey) previousConnectionKeys.add(previousConnectionKey);
    if (existingActive?.accountKey !== undefined) claimedAccountKeys.add(existingActive.accountKey);
    const account = existingActive ?? em.create(Account, { accountId });
    account.accountId = accountId;
    account.accountOwnerAppuserKey = connection.appuserKey;
    account.accountName ||= sessionAccount.name ?? connection.aspspName;
    account.accountNumber ||= sessionAccount.account_id?.iban ?? undefined;
    account.currencyKey = currency;
    account.accountFinancialInstitutionKey = institution;
    account.enableBankingConnectionKey = connection;
    if (connection.bankConnectionKey) account.bankConnectionKey = connection.bankConnectionKey;
    account.tenantKey = tenantKey;
    // Enable Banking reports the ISO 20022 cash account type here, and only here: the session
    // response is the one place it hands back account identity. `CARD` is a credit card.
    if (sessionAccount.cash_account_type === 'CARD') {
      const creditCardType = await em.findOne(AccountType, { description: 'CREDIT_CARD' });
      if (creditCardType) account.accountTypeKey = creditCardType;
    }
    if (existingDeleted) existingDeleted.deletedAt = undefined;

    try {
      await em.persist(account).flush();
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const reloaded = await em.findOne(Account, { accountId, accountOwnerAppuserKey: connection.appuserKey, deletedAt: undefined });
      if (!reloaded) throw error;
      reloaded.accountName = account.accountName;
      reloaded.accountNumber = account.accountNumber;
      reloaded.accountTypeKey = account.accountTypeKey;
      reloaded.currencyKey = account.currencyKey;
      reloaded.accountFinancialInstitutionKey = account.accountFinancialInstitutionKey;
      reloaded.enableBankingConnectionKey = account.enableBankingConnectionKey;
      reloaded.bankConnectionKey = account.bankConnectionKey;
      reloaded.tenantKey = account.tenantKey;
      await em.persist(reloaded).flush();
      accounts.push(reloaded);
      continue;
    }
    accounts.push(account);
  }

  const connectionsRetired = await retireEmptiedConnections(em, connection, previousConnectionKeys);

  return { accounts, accountsCreated: accounts.length, accountsSkipped: skippedReasons.length, connectionsRetired, skippedReasons };
}

/**
 * The existing account a reconnected session account stands for, or null. Matches on IBAN within
 * the same owner, household, bank and currency (one IBAN can carry several currency pockets, each
 * its own account), skipping accounts already claimed by an earlier session account of this batch.
 * Only active accounts match: an account the user removed is not brought back by a reconnect.
 */
async function findReconnectedAccount(
  em: EntityManagerLike,
  input: { claimedAccountKeys: Set<number>; connection: EnableBankingConnection; currency: Currency; iban: string | undefined; institution: AccountFinancialInstitution; tenantKey: NonNullable<EnableBankingConnection['tenantKey']> },
): Promise<Account | null> {
  const iban = input.iban?.trim();
  if (!iban) return null;
  const candidates = await em.find(Account, {
    accountFinancialInstitutionKey: input.institution,
    accountNumber: iban,
    accountOwnerAppuserKey: input.connection.appuserKey,
    currencyKey: input.currency,
    deletedAt: undefined,
    tenantKey: input.tenantKey,
  }, { orderBy: { accountKey: 'asc' } });
  return candidates.find((candidate) => !input.claimedAccountKeys.has(candidate.accountKey)) ?? null;
}

function isUniqueConstraintError(error: unknown) {
  if (error instanceof UniqueConstraintViolationException) return true;
  if (error instanceof Error && /unique|duplicate/i.test(error.message)) return true;
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && DUPLICATE_ERROR_CODES.has(code)) return true;
  }
  return false;
}

/** Soft-deletes the earlier connections (same owner and household) left with no active account. */
async function retireEmptiedConnections(em: EntityManagerLike, connection: EnableBankingConnection, connectionKeys: Set<number>): Promise<number> {
  let retired = 0;
  for (const enableBankingConnectionKey of connectionKeys) {
    const remaining = await em.count(Account, { deletedAt: undefined, enableBankingConnectionKey });
    if (remaining > 0) continue;
    const previous = await em.findOne(EnableBankingConnection, {
      appuserKey: connection.appuserKey,
      deletedAt: undefined,
      enableBankingConnectionKey,
      tenantKey: connection.tenantKey,
    });
    if (!previous) continue;
    previous.deletedAt = new Date();
    retired += 1;
  }
  if (retired > 0) {
    await em.flush();
    logger.info({ connectionsRetired: retired, enableBankingConnectionKey: connection.enableBankingConnectionKey }, 'Enable Banking reconnect moved every account off earlier connections; retired them');
  }
  return retired;
}
