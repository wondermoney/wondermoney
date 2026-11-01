import { QueryOrder } from '@mikro-orm/core';
import dotenv from 'dotenv';
import type { NextFunction, Request, Response } from 'express';
import { pick } from 'lodash-es';

import { Account } from '@entity/Account';
import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import { AccountType } from '@entity/AccountType';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { BankSyncFinality, BankSyncIncident } from '@entity/BankSyncIncident';
import { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { Transaction } from '@entity/Transaction';
import { TransactionStatus } from '@entity/TransactionStatus';
import { computeAvailableBalance } from '@service/account/account-available-balance.service';
import { resolveAccountCsvImportFormat } from '@service/account/account-csv-import-format';
import { computeSyncStatus } from '@service/account/account-sync-status.service';
import { ERROR_CODE, ForbiddenError, InternalServerError, NotFoundError } from '@utils/errors';

/*
 * The "not found" branches below are 404s, not 500s: each is a client supplying an id that does
 * not resolve — ordinary user error, not a server fault, so it must not page Sentry.
 *
 * For the account lookups this is also the right answer for a *cross-tenant* id: the tenant
 * filter makes another household's account invisible, so it returns null and the caller gets
 * 404 rather than 403. That is deliberate — a 403 would confirm the row exists.
 */
import { authedUser } from '@middleware/authed-context';
import { getFullName } from '@utils/misc';
import { convertMoney } from '@utils/money';
import { createOfflineAccountRequestSchema, deleteAccountRequestSchema, getAccountRequestSchema, updateAccountRequestSchema } from '@validators/account';
import { zParse } from '@validators/parser';

import { DI } from '../../app.js';
dotenv.config({ quiet: true });

export async function createOfflineAccount(req: Request, res: Response, next: NextFunction) {
  const authedUser_ = authedUser(req);
  const {
    body: { accountTypeId, currencyId, currentBalance, financialInstitutionId, name },
  } = await zParse(createOfflineAccountRequestSchema, req);
  const user = await DI.em.getRepository(Appuser).getUserById(authedUser_.appuserKey);
  if (!user) {
    next(new InternalServerError('User not found'));
    return;
  }
  const appUserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(authedUser_);
  if (!appUserTenant) {
    next(new InternalServerError("User doesn't have AppuserTenant"));
    return;
  }
  const account = new Account();
  account.accountName = name;
  account.tenantKey = appUserTenant.tenantKey;
  account.holderName = getFullName(user.firstName, user.lastName);
  const accountCurrency = await DI.em.findOne(Currency, { currencyKey: currencyId });
  if (!accountCurrency) {
    next(new NotFoundError(`Currency not found: ${currencyId}`));
    return;
  }
  account.currencyKey = accountCurrency;
  account.balance = currentBalance;
  const appuserCurrency = user.currencyKey;
  if (account.balance && accountCurrency.currencyKey !== appuserCurrency.currencyKey) {
    // If the account currency is different from the user's currency, we need to get the exchange
    // rate and convert the balance. No need to convert 0 balances
    const exchangeRate = await DI.em.findOne(
      ExchangeRate,
      {
        date: { $lte: new Date() },
        fromCurrency: accountCurrency,
        toCurrency: appuserCurrency,
      },
      {
        orderBy: { date: QueryOrder.DESC },
      },
    );
    if (exchangeRate) {
      account.appuserCurrencyBalance = convertMoney(account.balance, exchangeRate.rate);
    }
  } else {
    account.appuserCurrencyBalance = account.balance;
  }
  account.accountOwnerAppuserKey = appUserTenant.appuserKey;
  if (financialInstitutionId) {
    const accountFinancialInstitution = await DI.em.findOne(AccountFinancialInstitution, {
      accountFinancialInstitutionKey: financialInstitutionId,
    });
    if (!accountFinancialInstitution) {
      next(new NotFoundError(`Financial institution not found: ${financialInstitutionId}`));
      return;
    }
    account.accountFinancialInstitutionKey = accountFinancialInstitution;
  }
  if (accountTypeId) {
    const accountType = await DI.em.findOne(AccountType, { accountTypeKey: accountTypeId });
    if (!accountType) {
      next(new NotFoundError(`Account type not found: ${accountTypeId}`));
      return;
    }
    account.accountTypeKey = accountType;
  }
  await DI.em.persist(account).flush();
  return res.sendStatus(201);
}

export async function deleteAccount(req: Request, res: Response, next: NextFunction) {
  const {
    params: { accountId },
  } = await zParse(deleteAccountRequestSchema, req);
  const account = await DI.em.findOne(Account, {
    accountKey: accountId,
    deletedAt: undefined,
  });
  if (!account) {
    next(new NotFoundError(`Account not found: ${accountId}`));
    return;
  }
  account.deletedAt = new Date();
  await DI.em.persist(account).flush();
  return res.sendStatus(200);
}

export async function getAccount(req: Request, res: Response) {
  const {
    params: { accountId },
  } = await zParse(getAccountRequestSchema, req);
  if (!req.user || !req.tenant) {
    throw new InternalServerError('Authenticated user and tenant are required');
  }
  const account = await DI.em.findOne(
    Account,
    {
      accountKey: accountId,
      deletedAt: undefined,
      tenantKey: req.tenant,
    },
    {
      populate: [
        'accountFinancialInstitutionKey',
        'currencyKey',
        'accountOwnerAppuserKey',
        'accountOwnerAppuserKey.currencyKey',
        'nordigenRequisitionKey',
      ],
    },
  );
  if (!account) {
    throw new NotFoundError('Account not found');
  }

  const [openIncidentRequisitionIds, pendingSumsByAccount] = await Promise.all([
    loadOpenIncidentRequisitionIds(req.user),
    loadPendingSumsByAccount([account.accountKey]),
  ]);
  return res.json({ account: mapAccountSummary(account, { now: new Date(), openIncidentRequisitionIds, pendingSumsByAccount, viewerAppuserKey: req.user.appuserKey }) });
}

export async function getAccountFinancialInstitutions(_req: Request, res: Response) {
  const accountFinancialInstitutions = await DI.em.find(
    AccountFinancialInstitution,
    // A soft-deleted institution was merged into another and is not offered.
    { deletedAt: undefined },
    {
      orderBy: { name: QueryOrder.ASC },
    },
  );
  // pick only the key and name
  const transformedData = accountFinancialInstitutions.map((a) =>
    pick(a, ['accountFinancialInstitutionKey', 'displayName', 'logoUrl']),
  );
  return res.json({ accountFinancialInstitutions: transformedData });
}

export async function getAccounts(req: Request, res: Response) {
  if (!req.user || !req.tenant) {
    throw new InternalServerError('Authenticated user and tenant are required');
  }
  const accounts = await DI.em.find(
    Account,
    {
      deletedAt: undefined,
      tenantKey: req.tenant,
    },
    {
      orderBy: [{ accountName: QueryOrder.ASC }, { accountKey: QueryOrder.ASC }],
      populate: [
        'accountFinancialInstitutionKey',
        'currencyKey',
        'accountOwnerAppuserKey',
        'accountOwnerAppuserKey.currencyKey',
        'nordigenRequisitionKey',
      ],
    },
  );
  const [openIncidentRequisitionIds, pendingSumsByAccount] = await Promise.all([
    loadOpenIncidentRequisitionIds(req.user),
    loadPendingSumsByAccount(accounts.map((account) => account.accountKey)),
  ]);
  const syncContext = { now: new Date(), openIncidentRequisitionIds, pendingSumsByAccount, viewerAppuserKey: req.user.appuserKey };
  const transformedData = accounts.map((account) => mapAccountSummary(account, syncContext));
  return res.json({ accounts: transformedData });
}

/** Read-only lookup so the web "Add account" form can populate a real type dropdown. */
export async function getAccountTypes(_req: Request, res: Response) {
  const accountTypes = await DI.em.find(
    AccountType,
    {},
    {
      orderBy: { description: QueryOrder.ASC },
    },
  );
  const transformedData = accountTypes.map((a) => pick(a, ['accountTypeKey', 'description']));
  return res.json({ accountTypes: transformedData });
}

export async function getCurrencies(_req: Request, res: Response) {
  const currencies = await DI.em.find(
    Currency,
    {
      isActive: true,
    },
    {
      orderBy: { code: QueryOrder.ASC },
    },
  );
  const transformedData = currencies.map((c) => pick(c, ['currencyKey', 'code', 'description']));
  return res.json({ currencies: transformedData });
}

/** Per-account pending totals (account currency + owner currency), already signed. */
export interface PendingSums {
  appuserSettlement: number;
  settlement: number;
}

/** Context for the per-account stale-sync signal and available balance. */
export interface AccountSyncContext {
  now: Date;
  /** requisitionIds that currently have an open (non-terminal, user-visible) sync incident. */
  openIncidentRequisitionIds: Set<string>;
  /** Summed pending amounts per accountKey. Absent → available balance equals current balance. */
  pendingSumsByAccount?: Map<number, PendingSums>;
  /** The requesting member's appuserKey — drives per-account ownership flags. */
  viewerAppuserKey?: number;
}

export function mapAccountSummary(account: Account, syncContext?: AccountSyncContext) {
  const currencyCode = resolveRequiredCurrencyCode(account.currencyKey.code, 'account');
  const ownerCurrencyCode = resolveRequiredCurrencyCode(
    account.accountOwnerAppuserKey?.currencyKey.code,
    'account owner',
  );
  const institution = account.accountFinancialInstitutionKey;
  const source = account.nordigenRequisitionKey || account.accountId ? ('open_banking' as const) : ('manual' as const);
  const pending = syncContext?.pendingSumsByAccount?.get(account.accountKey);

  return {
    accountFinancialInstitutionKey: institution
      ? {
          displayName: institution.displayName ?? null,
          logoUrl: institution.logoUrl ?? null,
        }
      : null,
    accountKey: account.accountKey,
    accountName: account.accountName ?? null,
    accountOwnerAppuserKey: { currencyKey: { code: ownerCurrencyCode } },
    appuserCurrencyAvailableBalance:
      account.appuserCurrencyBalance == null && !pending ? null : computeAvailableBalance(account.appuserCurrencyBalance, [pending?.appuserSettlement]),
    appuserCurrencyBalance: account.appuserCurrencyBalance ?? null,
    availableBalance: account.balance == null && !pending ? null : computeAvailableBalance(account.balance, [pending?.settlement]),
    balance: account.balance ?? null,
    // Which file the account's CSV import reads: the bank's statement export, or the generic format.
    csvImportFormat: resolveAccountCsvImportFormat(institution?.name).format,
    currencyKey: { code: currencyCode },
    // Household: privacy state + who owns the account, for the privacy
    // toggle (owner-only) and shared-context surfacing.
    isOwnedByViewer:
      syncContext?.viewerAppuserKey != null &&
      account.accountOwnerAppuserKey?.appuserKey === syncContext.viewerAppuserKey,
    isPrivate: account.isPrivate,
    ownerFirstName: account.accountOwnerAppuserKey?.firstName ?? null,
    refreshedAt: account.refreshedAt?.toISOString() ?? null,
    source,
    syncStatus: syncContext
      ? computeSyncStatus({
          hasOpenIncident: isAccountIncidentOpen(account, syncContext.openIncidentRequisitionIds),
          lastSyncedAt: account.transactionsRefreshedAt ?? account.refreshedAt ?? null,
          now: syncContext.now,
          source,
        })
      : null,
  };
}

function isAccountIncidentOpen(account: Account, openIncidentRequisitionIds: Set<string>): boolean {
  const requisitionId = account.nordigenRequisitionKey?.requisitionId;
  return requisitionId ? openIncidentRequisitionIds.has(requisitionId) : false;
}

/**
 * requisitionIds with an open (non-terminal) user-visible sync incident for this user — the set
 * used to flag accounts as `error` in the DTO. Empty set on any failure so staleness degrades to
 * a recency-only signal rather than breaking the accounts list.
 */
export async function updateAccount(req: Request, res: Response, next: NextFunction) {
  const user = authedUser(req);
  const {
    body: { accountName, isPrivate },
    params: { accountId },
  } = await zParse(updateAccountRequestSchema, req);
  const account = await DI.em.findOne(Account, {
    accountKey: accountId,
    deletedAt: undefined,
  });
  if (!account) {
    next(new NotFoundError(`Account not found: ${accountId}`));
    return;
  }
  if (accountName !== undefined) {
    account.accountName = accountName;
  }
  if (isPrivate !== undefined) {
    // Only the account owner controls its privacy (hiding it from
    // other household members). Other members may rename a shared account but not
    // change whether it's private.
    const ownerAppuserKey = (account.accountOwnerAppuserKey as unknown as undefined | { appuserKey: number })?.appuserKey;
    if (ownerAppuserKey !== user.appuserKey) {
      next(new ForbiddenError('Only the account owner can change its privacy.', ERROR_CODE.ACCOUNT_OWNER_REQUIRED));
      return;
    }
    account.isPrivate = isPrivate;
  }
  await DI.em.persist(account).flush();
  return res.sendStatus(200);
}

/**
 * Sum of pending (unsettled) transaction amounts per account, for the available-balance display.
 * Empty map on any failure so available balance degrades to the current balance rather than
 * breaking the accounts list.
 */
async function loadOpenIncidentRequisitionIds(appuserKey: Appuser): Promise<Set<string>> {
  try {
    const incidents = await DI.em.find(
      BankSyncIncident,
      { appuserKey, deletedAt: undefined, finality: BankSyncFinality.NON_TERMINAL, userVisible: true },
      { fields: ['requisitionId'] },
    );
    return new Set(incidents.map((incident) => incident.requisitionId).filter((id): id is string => Boolean(id)));
  } catch {
    // Degrade to a recency-only staleness signal rather than breaking the accounts list.
    return new Set();
  }
}

async function loadPendingSumsByAccount(accountKeys: number[]): Promise<Map<number, PendingSums>> {
  const sums = new Map<number, PendingSums>();
  if (accountKeys.length === 0) return sums;
  try {
    const pendingStatus = await DI.em.findOne(TransactionStatus, { name: 'PENDING' });
    if (!pendingStatus) return sums;
    const pendings = await DI.em.find(
      Transaction,
      { accountKey: { accountKey: { $in: accountKeys } }, deletedAt: undefined, transactionStatusKey: pendingStatus },
      { fields: ['accountKey', 'settlementAmount', 'appuserSettlementAmount'] },
    );
    for (const pending of pendings) {
      const accountKey = pending.accountKey?.accountKey;
      if (!accountKey) continue;
      const current = sums.get(accountKey) ?? { appuserSettlement: 0, settlement: 0 };
      current.settlement += pending.settlementAmount ?? 0;
      current.appuserSettlement += pending.appuserSettlementAmount ?? 0;
      sums.set(accountKey, current);
    }
  } catch {
    return new Map();
  }
  return sums;
}

function resolveRequiredCurrencyCode(code: string | undefined, relation: string): string {
  if (!code || !/^[A-Z]{3}$/.test(code)) {
    throw new InternalServerError(`Required ${relation} currency relation is unavailable`);
  }
  return code;
}
