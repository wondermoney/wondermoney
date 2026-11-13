import { QueryOrder } from '@mikro-orm/core';
import dotenv from 'dotenv';
import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pick } from 'lodash-es';

import { Account } from '@entity/Account';
import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import { AccountType } from '@entity/AccountType';
import { Appuser } from '@entity/Appuser';
import { AppuserAccountPosition } from '@entity/AppuserAccountPosition';
import { AppuserTenant } from '@entity/AppuserTenant';
import { BankSyncFinality, BankSyncIncident } from '@entity/BankSyncIncident';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { Currency } from '@entity/Currency';
import { Transaction } from '@entity/Transaction';
import { TransactionStatus } from '@entity/TransactionStatus';
import { type AccountAccess, accountActor, loadAccountAccess } from '@service/account/account-access';
import { computeAvailableBalance } from '@service/account/account-available-balance.service';
import { resolveAccountCsvImportFormat } from '@service/account/account-csv-import-format';
import { startAccountRecalculation } from '@service/account/account-recalculation.service';
import { getAccountShares, setAccountPrivacy, setAccountShares } from '@service/account/account-share.service';
import { computeSyncStatus } from '@service/account/account-sync-status.service';
import { mapCreditCardDetail } from '@service/account/credit-card-statement.service';
import type { BankSyncLastError } from '@service/bank-sync/bank-sync-history.service';
import { convertWithStatus, type RateScope, rateScope } from '@service/currency/exchange-rate';
import { describeFx, type FxDisplay, UNKNOWN_FX } from '@service/currency/fx-display';
import { accountAttributionDto, loadActiveMembers } from '@service/household/member-attribution';
import { isManualAccount } from '@service/transaction/balance-chain.service';
import { BadRequestError, ERROR_CODE, ForbiddenError, InternalServerError, NotFoundError } from '@utils/errors';

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
import { createOfflineAccountRequestSchema, deleteAccountRequestSchema, getAccountRequestSchema, getAccountSharesRequestSchema, putAccountSharesRequestSchema, recalculateAccountRequestSchema, reorderAccountsRequestSchema, updateAccountRequestSchema } from '@validators/account';
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
  // The typed balance is what the account held when it was opened: net worth history counts it
  // from today until a transaction carries a running balance.
  account.openingBalance = currentBalance;
  account.openingBalanceDate = new Date();
  // The balance in the owner's currency, through the one rate resolver. With no rate none is
  // stored (`missing`), so totals report the account as unconverted rather than at face value.
  const converted = await convertWithStatus(DI.em, account.balance, accountCurrency, user.currencyKey, new Date(), rateScope(appUserTenant.tenantKey));
  account.appuserCurrencyBalance = converted.amount;
  account.fxStatus = converted.fxStatus;
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
        'accountTypeKey',
        'currencyKey',
        'accountOwnerAppuserKey',
        'accountOwnerAppuserKey.currencyKey',
        'enableBankingConnectionKey',
        'nordigenRequisitionKey',
      ],
    },
  );
  if (!account) {
    throw new NotFoundError('Account not found');
  }

  const [syncIncidentContext, pendingSumsByAccount, [fx], accessByAccount, members] = await Promise.all([
    loadSyncIncidentContext(req.user),
    loadPendingSumsByAccount([account.accountKey]),
    describeAccountsFx([account], rateScope(req.tenant)),
    loadAccountAccess(DI.em, [account.accountKey], accountActor(req)),
    loadActiveMembers(DI.em, req.tenant.tenantKey),
  ]);
  const creditCard = await DI.em.findOne(CreditCardDetail, { accountKey: { accountKey: account.accountKey }, deletedAt: undefined });
  return res.json({ account: mapAccountSummary(account, { ...syncIncidentContext, accessByAccount, members, now: new Date(), pendingSumsByAccount, viewerAppuserKey: req.user.appuserKey }, fx, creditCard ? mapCreditCardDetail(creditCard) : null) });
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
        'accountTypeKey',
        'currencyKey',
        'accountOwnerAppuserKey',
        'accountOwnerAppuserKey.currencyKey',
        'enableBankingConnectionKey',
        'nordigenRequisitionKey',
      ],
    },
  );
  const [syncIncidentContext, pendingSumsByAccount, fx, accessByAccount, members] = await Promise.all([
    loadSyncIncidentContext(req.user),
    loadPendingSumsByAccount(accounts.map((account) => account.accountKey)),
    describeAccountsFx(accounts, rateScope(req.tenant)),
    loadAccountAccess(DI.em, accounts.map((account) => account.accountKey), accountActor(req)),
    loadActiveMembers(DI.em, req.tenant.tenantKey),
  ]);
  const positions = await DI.em.find(AppuserAccountPosition, { appuserKey: req.user });
  const positionByAccount = new Map<number, number>();
  for (const position of positions) {
    const accountKey = relationAccountKey(position.accountKey);
    if (accountKey != null) positionByAccount.set(accountKey, position.position);
  }
  // `sort` is stable, so the name order above survives among accounts with the same place.
  // An account this member has not placed (a new one) sorts after every placed one.
  accounts.sort((a, b) => (positionByAccount.get(a.accountKey) ?? Number.MAX_SAFE_INTEGER) - (positionByAccount.get(b.accountKey) ?? Number.MAX_SAFE_INTEGER));
  const creditCards = await loadCreditCardDetailsByAccount(accounts.map((account) => account.accountKey));
  const syncContext = { ...syncIncidentContext, accessByAccount, members, now: new Date(), pendingSumsByAccount, viewerAppuserKey: req.user.appuserKey };
  const transformedData = accounts.map((account, index) => mapAccountSummary(account, syncContext, fx[index], creditCards.get(account.accountKey) ?? null));
  return res.json({ accounts: transformedData });
}

/**
 * `PUT /v1/account/order`: this member's accounts in their new display order, each once. Every
 * id must be an account they can see — another household's, or the other member's private one,
 * is refused (400) rather than silently ordered. A closed account is skipped: it keeps no place
 * and does not fail the request. Positions are per member, so a household's orders never collide.
 */
export async function reorderAccounts(req: Request, res: Response) {
  const user = authedUser(req);
  const {
    body: { accountIds },
  } = await zParse(reorderAccountsRequestSchema, req);

  await DI.em.transactional(async (txEm) => {
    const accounts = await txEm.find(Account, { accountKey: { $in: accountIds }, deletedAt: undefined });
    const byKey = new Map(accounts.map((account) => [account.accountKey, account]));
    if (accountIds.some((accountKey) => !byKey.has(accountKey))) {
      throw new BadRequestError('Every account in the order must be one you can see');
    }
    const ordered = accountIds.flatMap((accountKey) => {
      const account = byKey.get(accountKey);
      return account && !account.closed ? [account] : [];
    });
    const existing = await txEm.find(AppuserAccountPosition, { appuserKey: user });
    const existingByAccount = new Map<number, AppuserAccountPosition>();
    for (const position of existing) {
      const accountKey = relationAccountKey(position.accountKey);
      if (accountKey != null) existingByAccount.set(accountKey, position);
    }
    ordered.forEach((account, index) => {
      const position = existingByAccount.get(account.accountKey);
      if (position) position.position = index;
      else txEm.create(AppuserAccountPosition, { accountKey: account, appuserKey: user, position: index }, { partial: true });
    });
    await txEm.flush();
  });
  return res.sendStatus(200);
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
  /** Newest failure per requisition id, for the account's `syncStatus.lastError`. */
  lastErrorByRequisitionId: Map<string, BankSyncLastError>;
  now: Date;
  /** requisitionIds that currently have an open (non-terminal, user-visible) sync incident. */
  openIncidentRequisitionIds: Set<string>;
  /** Summed pending amounts per accountKey. Absent → available balance equals current balance. */
  pendingSumsByAccount?: Map<number, PendingSums>;
  /** The requesting member's appuserKey — drives per-account ownership flags. */
  viewerAppuserKey?: number;
  /** The requesting member's access to each account (`account-access.ts`), for `myAccess`. */
  accessByAccount?: Map<number, AccountAccess>;
  /** The household's active members by key, for the account's attribution (`member-attribution.ts`). */
  members?: ReadonlyMap<number, string>;
}

/**
 * How each account's balance in its owner's currency was converted. Balances are revalued at the
 * latest rate (`fx-reconvert.service.ts`), so a provisional one is dated by today's latest rate.
 */
function describeAccountsFx(accounts: Account[], scope: RateScope): Promise<FxDisplay[]> {
  const now = new Date();
  return describeFx(
    DI.em,
    accounts.map((account) => ({ converted: account.appuserCurrencyBalance, date: now, from: account.currencyKey, status: account.fxStatus, to: account.accountOwnerAppuserKey?.currencyKey })),
    scope,
  );
}

/** `fx` says how the balance was converted; without it the account reports no FX status. */
export function mapAccountSummary(account: Account, syncContext?: AccountSyncContext, fx: FxDisplay = UNKNOWN_FX, creditCard: null | ReturnType<typeof mapCreditCardDetail> = null) {
  const currencyCode = resolveRequiredCurrencyCode(account.currencyKey.code, 'account');
  const ownerCurrencyCode = resolveRequiredCurrencyCode(
    account.accountOwnerAppuserKey?.currencyKey.code,
    'account owner',
  );
  const institution = account.accountFinancialInstitutionKey;
  const source = account.nordigenRequisitionKey || account.accountId ? ('open_banking' as const) : ('manual' as const);
  const pending = syncContext?.pendingSumsByAccount?.get(account.accountKey);
  const requisitionId = accountRequisitionId(account);

  return {
    accountFinancialInstitutionKey: institution
      ? {
          displayName: institution.displayName ?? null,
          logoUrl: institution.logoUrl ?? null,
        }
      : null,
    accountKey: account.accountKey,
    accountName: account.accountName ?? null,
    // The type's key ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'MORTGAGE', 'LOAN', 'INVESTMENT'), so a
    // client can pick a glyph for an account with no institution logo. Null when none was set.
    accountOwnerAppuserKey: { currencyKey: { code: ownerCurrencyCode } },
    accountType: account.accountTypeKey?.description ?? null,
    // The card's cycle and limit, or null for a non-card account. Drives the card settings and the
    // statement summary on web and mobile.
    appuserCurrencyAvailableBalance:
      account.appuserCurrencyBalance == null && !pending ? null : computeAvailableBalance(account.appuserCurrencyBalance, [pending?.appuserSettlement]),
    appuserCurrencyBalance: account.appuserCurrencyBalance ?? null,
    availableBalance: account.balance == null && !pending ? null : computeAvailableBalance(account.balance, [pending?.settlement]),
    balance: account.balance ?? null,
    creditCard,
    // Which file the account's CSV import reads: the bank's statement export, or the generic format.
    csvImportFormat: resolveAccountCsvImportFormat(institution?.name).format,
    currencyKey: { code: currencyCode },
    fxRateDate: fx.fxRateDate,
    fxStatus: fx.fxStatus,
    // Household: privacy state + who owns the account, for the privacy
    // toggle (owner-only) and shared-context surfacing.
    isOwnedByViewer:
      syncContext?.viewerAppuserKey != null &&
      account.accountOwnerAppuserKey?.appuserKey === syncContext.viewerAppuserKey,
    isPrivate: account.isPrivate,
    // The viewer's access ('owner', 'write' or 'read'), so a client hides what it cannot do. Without
    // the loaded access a private account the viewer does not own reads as view-only.
    myAccess: syncContext?.accessByAccount?.get(account.accountKey)
      ?? (account.accountOwnerAppuserKey?.appuserKey === syncContext?.viewerAppuserKey ? 'owner' : account.isPrivate ? 'read' : 'write'),
    // Whose money the account is for reporting: its owner, or Shared (null) when joint or when its
    // owner has left the household. Not who can see it.
    attribution: accountAttributionDto(account, syncContext?.members ?? new Map()),
    isJoint: account.isJoint,
    ownerAppuserKey: account.accountOwnerAppuserKey?.appuserKey ?? null,
    ownerFirstName: account.accountOwnerAppuserKey?.firstName ?? null,
    refreshedAt: account.refreshedAt?.toISOString() ?? null,
    source,
    syncStatus: syncContext
      ? computeSyncStatus({
          hasOpenIncident: requisitionId ? syncContext.openIncidentRequisitionIds.has(requisitionId) : false,
          lastError: requisitionId ? syncContext.lastErrorByRequisitionId.get(requisitionId) ?? null : null,
          lastSyncedAt: account.transactionsRefreshedAt ?? account.refreshedAt ?? null,
          now: syncContext.now,
          source,
        })
      : null,
  };
}

/**
 * The provider-issued id incidents store for the account's connection: the legacy
 * requisition id, or the Enable Banking session (falling back to the pre-link state).
 */
function accountRequisitionId(account: Account): string | undefined {
  const legacy = (account.nordigenRequisitionKey as unknown as undefined | { requisitionId?: string })?.requisitionId;
  if (legacy) return legacy;
  const connection = account.enableBankingConnectionKey as unknown as undefined | { sessionId?: null | string; state?: string };
  return connection?.sessionId ?? connection?.state;
}

/**
 * requisitionIds with an open (non-terminal) user-visible sync incident for this user — the set
 * used to flag accounts as `error` in the DTO. Empty set on any failure so staleness degrades to
 * a recency-only signal rather than breaking the accounts list.
 */
export async function updateAccount(req: Request, res: Response, next: NextFunction) {
  const user = authedUser(req);
  const {
    body: { accountName, isJoint, isPrivate, openingBalance, openingBalanceDate },
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
    // The account owner or the household owner controls whether it is private (hidden from the
    // members it is not shared with). Other members may rename a shared account but not change
    // who sees it. `PUT /v1/account/:accountId/shares` is the full control.
    await setAccountPrivacy(DI.em, account, accountActor(req), isPrivate);
  }
  if (isJoint !== undefined) {
    // Joint is the owner's to say, like privacy: it moves the account's money from them to Shared
    // in every report and member filter (`member-attribution.ts`). It changes nobody's access.
    const ownerAppuserKey = (account.accountOwnerAppuserKey as unknown as undefined | { appuserKey: number })?.appuserKey;
    if (ownerAppuserKey !== user.appuserKey) {
      next(new ForbiddenError('Only the account owner can mark it as joint.', ERROR_CODE.ACCOUNT_OWNER_REQUIRED));
      return;
    }
    account.isJoint = isJoint;
  }
  const opensDifferently = openingBalance !== undefined || openingBalanceDate !== undefined;
  if (opensDifferently) {
    // A synced account's balance is the bank's; only a manual or CSV account opens on a figure
    // the person typed.
    if (!isManualAccount(account)) {
      next(new BadRequestError('Only a manual account has an opening balance to edit', ERROR_CODE.OPENING_BALANCE_MANUAL_ONLY));
      return;
    }
    if (openingBalance !== undefined) account.openingBalance = openingBalance;
    if (openingBalanceDate !== undefined) account.openingBalanceDate = openingBalanceDate;
  }
  await DI.em.persist(account).flush();
  if (!opensDifferently) return res.sendStatus(200);
  // The new opening balance only reaches the running balances through a rebuild, so this one is
  // not rate-limited. Committed first: a run that starts from here on reads it.
  const { operationId } = await startAccountRecalculation(DI.em, { accountKey: account.accountKey, appuserKey: user.appuserKey, tenantKey: account.tenantKey.tenantKey }, { enqueue: req.enqueue }, { rateLimited: false });
  return res.status(200).json({ operationId });
}

/** `GET /v1/account/:accountId/shares`: who sees and who changes the account (404 when the caller cannot see it). */
export async function getAccountSharesController(req: Request, res: Response) {
  const {
    params: { accountId },
  } = await zParse(getAccountSharesRequestSchema, req);
  return res.json(await getAccountShares(DI.em, accountId, accountActor(req)));
}

/**
 * `PUT /v1/account/:accountId/shares`: replace who sees and who changes the account. Only the
 * account owner or the household owner (403 `account_share_manager_required`).
 */
export async function putAccountSharesController(req: Request, res: Response) {
  const {
    body,
    params: { accountId },
  } = await zParse(putAccountSharesRequestSchema, req);
  return res.json(await setAccountShares(DI.em, accountId, accountActor(req), body));
}

/**
 * `POST /v1/account/:accountId/recalculate`: queue a rebuild of the account's running balances and
 * answer the operation id to follow on `GET /v1/operations/:id` (202). The tenant filter finds the
 * account, so another household's account, or the other member's private one, is a 404. 429
 * `account_recalculation_too_soon` within a minute of the account's last recalculation.
 */
export async function recalculateAccount(req: Request, res: Response) {
  const user = authedUser(req);
  const {
    params: { accountId },
  } = await zParse(recalculateAccountRequestSchema, req);
  const account = await DI.em.findOne(Account, { accountKey: accountId, deletedAt: undefined });
  if (!account) throw new NotFoundError(`Account not found: ${accountId}`);
  const { operationId } = await startAccountRecalculation(DI.em, { accountKey: account.accountKey, appuserKey: user.appuserKey, tenantKey: account.tenantKey.tenantKey }, { enqueue: req.enqueue });
  return res.status(StatusCodes.ACCEPTED).json({ operationId });
}

/**
 * Card settings per account, for the account list and detail. One query for the whole list; an
 * account with no row is simply not a card.
 */
async function loadCreditCardDetailsByAccount(accountKeys: number[]): Promise<Map<number, ReturnType<typeof mapCreditCardDetail>>> {
  const cards = new Map<number, ReturnType<typeof mapCreditCardDetail>>();
  if (accountKeys.length === 0) return cards;
  const details = await DI.em.find(CreditCardDetail, { accountKey: { accountKey: { $in: accountKeys } }, deletedAt: undefined });
  for (const detail of details) {
    const accountKey = detail.accountKey.accountKey;
    if (accountKey) cards.set(accountKey, mapCreditCardDetail(detail));
  }
  return cards;
}

/**
 * Sum of pending (unsettled) transaction amounts per account, for the available-balance display.
 * Empty map on any failure so available balance degrades to the current balance rather than
 * breaking the accounts list.
 */
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

/**
 * The caller's sync incidents, reduced to the two signals the accounts list needs:
 * which requisitions currently have an open incident, and the newest failure per
 * requisition. Empty on any failure so staleness degrades to a recency-only signal
 * rather than breaking the accounts list.
 */
async function loadSyncIncidentContext(appuserKey: Appuser): Promise<Pick<AccountSyncContext, 'lastErrorByRequisitionId' | 'openIncidentRequisitionIds'>> {
  try {
    const incidents = await DI.em.find(
      BankSyncIncident,
      { appuserKey, deletedAt: undefined },
      { fields: ['errorCode', 'finality', 'requisitionId', 'updatedAt', 'userVisible'], orderBy: { updatedAt: QueryOrder.DESC } },
    );
    const openIncidentRequisitionIds = new Set<string>();
    const lastErrorByRequisitionId = new Map<string, BankSyncLastError>();
    for (const incident of incidents) {
      if (!incident.requisitionId) continue;
      if (incident.finality === BankSyncFinality.NON_TERMINAL && incident.userVisible === true) {
        openIncidentRequisitionIds.add(incident.requisitionId);
      }
      if (incident.errorCode && !lastErrorByRequisitionId.has(incident.requisitionId)) {
        lastErrorByRequisitionId.set(incident.requisitionId, { code: incident.errorCode, occurredAt: incident.updatedAt.toISOString() });
      }
    }
    return { lastErrorByRequisitionId, openIncidentRequisitionIds };
  } catch {
    return { lastErrorByRequisitionId: new Map(), openIncidentRequisitionIds: new Set() };
  }
}

function resolveRequiredCurrencyCode(code: string | undefined, relation: string): string {
  if (!code || !/^[A-Z]{3}$/.test(code)) {
    throw new InternalServerError(`Required ${relation} currency relation is unavailable`);
  }
  return code;
}

/** The account key of an `Account` relation that was not populated, read without loading the row. */
function relationAccountKey(value: unknown): number | undefined {
  const accountKey = (value as undefined | { accountKey?: unknown })?.accountKey;
  return typeof accountKey === 'number' ? accountKey : undefined;
}
