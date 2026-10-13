import { UniqueConstraintViolationException } from '@mikro-orm/core';

import { Account } from '@entity/Account';
import { AccountFinancialInstitution, AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { Currency } from '@entity/Currency';
import type { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { buildEnableBankingInstitutionRecordId } from '@utils/enable-banking-institution-id';
import { InternalServerError } from '@utils/errors';
import logger from '@utils/logger';

/**
 * Phase 1d: the shape of one entry in Enable Banking's `POST /sessions` response `accounts[]`
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
  skippedReasons: string[];
}

export interface EnableBankingSessionAccount {
  account_id?: { iban?: string };
  currency?: string;
  name?: string;
  uid?: string;
}

interface EntityManagerLike {
  create<T>(entityClass: new (...args: never[]) => T, data: Partial<T>): T;
  findOne<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<null | T>;
  findOneOrFail<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>): Promise<T>;
  persist(entity: unknown): { flush(): Promise<void> };
}

const DUPLICATE_ERROR_CODES = new Set(['23505']);

/**
 * Persists `Account` rows from a freshly-linked `EnableBankingConnection`'s session accounts —
 * the Enable Banking equivalent of `controller/account/sync.ts`'s `createInitialAccounts`
 * (GoCardless), adapted for two structural differences:
 *
 * 1. This runs from `enableBankingCallback`, an **unauthenticated** provider redirect with no
 *    `req.user`/`req.tenant` — identity comes from `connection.appuserKey`/`.tenantKey` (the
 *    values `startBankConnection` captured at link-start time, RAD-244-style) instead.
 * 2. Enable Banking's session account (`uid`/`account_id.iban`/`name`/`currency`) carries no
 *    balance and no institution id of its own — the institution is the connection's own
 *    `aspspName`/`aspspCountry` (one connection == one bank), and balances are fetched later by
 *    the initial-sync job this function's caller enqueues, not here.
 *
 * Best-effort per account: a single account with an unresolvable currency is skipped (logged),
 * not fatal to the whole batch — unlike GoCardless's `createInitialAccounts`, which can `next()`
 * a request-scoped error, this has no HTTP response to fail; skipping and letting the rest of the
 * bank's accounts link is strictly better than aborting all of them over one bad row.
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

    // Same soft-delete-revival + accountId/owner keying as `createInitialAccounts` (GoCardless);
    // no IBAN-fallback dedup here (unlike `account-initial-sync-account.service.ts`'s RAD-631
    // fix) — that fix exists for *re-sync* collapsing a second requisition onto the same
    // real-world account, which cannot happen at first-link time, since this only ever runs once
    // per connection immediately after `changeToLinked`.
    const existingDeleted = await em.findOne(Account, { accountId, accountOwnerAppuserKey: connection.appuserKey, deletedAt: { $ne: null } });
    const existingActive = existingDeleted ?? await em.findOne(Account, { accountId, accountOwnerAppuserKey: connection.appuserKey, deletedAt: undefined });
    const account = existingActive ?? em.create(Account, { accountId });
    account.accountId = accountId;
    account.accountOwnerAppuserKey = connection.appuserKey;
    account.accountName ||= sessionAccount.name ?? connection.aspspName;
    account.accountNumber ||= sessionAccount.account_id?.iban ?? undefined;
    account.currencyKey = currency;
    account.accountFinancialInstitutionKey = institution;
    account.enableBankingConnectionKey = connection;
    account.tenantKey = tenantKey;
    if (existingDeleted) existingDeleted.deletedAt = undefined;

    try {
      await em.persist(account).flush();
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const reloaded = await em.findOne(Account, { accountId, accountOwnerAppuserKey: connection.appuserKey, deletedAt: undefined });
      if (!reloaded) throw error;
      reloaded.accountName = account.accountName;
      reloaded.accountNumber = account.accountNumber;
      reloaded.currencyKey = account.currencyKey;
      reloaded.accountFinancialInstitutionKey = account.accountFinancialInstitutionKey;
      reloaded.enableBankingConnectionKey = account.enableBankingConnectionKey;
      reloaded.tenantKey = account.tenantKey;
      await em.persist(reloaded).flush();
      accounts.push(reloaded);
      continue;
    }
    accounts.push(account);
  }

  return { accounts, accountsCreated: accounts.length, accountsSkipped: skippedReasons.length, skippedReasons };
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
