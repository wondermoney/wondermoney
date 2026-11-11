import { type EntityManager, UniqueConstraintViolationException } from '@mikro-orm/core';
import * as Sentry from '@sentry/node';

import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { AccountFinancialInstitution, AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { AccountType } from '@entity/AccountType';
import { AppuserTenant } from '@entity/AppuserTenant';
import { BankConnectionStatus } from '@entity/BankConnection';
import { Currency } from '@entity/Currency';
import { FxStatus } from '@entity/Transaction';
import type { BankConnectionRef, BankProvider } from '@service/bank-providers/types';
import { isProviderRejection, type ProviderRateLimit, providerRateLimitOf } from '@service/bank-sync-run/provider-failure';
import { convertWithStatus, type FxConversion, rateScope } from '@service/currency/exchange-rate';
import backgroundOperationService from '@service/operations/background-operation.service';
import { sanitizeProviderResponse } from '@utils/error-sanitizer';
import { ConflictError, InternalServerError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

/**
 * `requisitionId`/`requisitionKey` are legacy names for provider-agnostic "sync target identity"
 * fields: for an Enable Banking connection they carry
 * `EnableBankingConnection.sessionId` (falling back to `.state`) and `.enableBankingConnectionKey`
 * respectively. Not renamed — see `account-initial-sync-enqueue.service.ts` and
 * `jobs/account-initial-sync.worker.ts` for the same judgment call, documented once there.
 */
export interface AccountInitialSyncAccountsResult {
  accountsCreated: number;
  accountsFailed: number;
  accountsFetched: number;
  accountsTotal: number;
  accountsUpdated: number;
  appuserKey: number;
  failedAccountIds: string[];
  institutionIds: string[];
  /** Every account failed, and each with a provider 400 or 401: a likely sign of ended consent. */
  everyAccountRejected?: boolean;
  /** The provider rate-limited a call; the phase stopped there. */
  rateLimited?: ProviderRateLimit;
  requisitionId: string;
  requisitionKey: number;
  status: 'completed' | 'failed' | 'partial';
}

interface AccountBalanceResponseLike { balances?: { balanceAmount?: { amount?: string }; balanceType?: string }[] }

/**
 * Which of the provider's balances becomes `account.balance`, in preference order.
 *
 * The Berlin Group balances array is a *set* of balance types, and the array order is not part of
 * the contract. Taking whichever entry happened to come first would let `account.balance` silently
 * flip between a booked balance and one that includes pending authorisations, changing by the
 * pending float between two syncs with no transaction to explain it. Since the running-balance
 * chain is anchored on `account.balance` (see `balance-chain.service.ts`), an
 * anchor that flips type would shift every row on the account, so the choice has to be deterministic.
 *
 * Booked balances first: they are the ones the settled chain can actually reconcile against.
 * Available/expected balances only as a fallback for institutions that publish nothing else.
 */
const BALANCE_TYPE_PREFERENCE = ['closingBooked', 'interimBooked', 'openingBooked', 'expected', 'interimAvailable', 'forwardAvailable', 'nonInvoiced'] as const;

interface Deps {
  backgroundOperationService?: typeof backgroundOperationService;
  em?: {
    create<T>(entityClass: new (...args: never[]) => T, data: Partial<T>): T;
    find<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<T[]>;
    findOne<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<null | T>;
    findOneOrFail<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>): Promise<T>;
    persist(entity: unknown): { flush(): Promise<void> };
  };
  logger?: Pick<typeof logger, 'error' | 'info' | 'warn'>;
  /**
   * The aggregator to sync through. Tests inject a fake provider; production callers get it
   * from the registry (`bank-providers/registry.ts`).
   */
  provider?: BankProvider;
}

/**
 * Undefined when the provider sent no usable balance. That is a failed fetch, not a zero balance:
 * reading it as zero would overwrite the real balance and mark the account fresh.
 */
export function selectProviderBalanceAmount(response: AccountBalanceResponseLike): string | undefined {
  const usable = (response.balances ?? []).filter((item) => item.balanceAmount?.amount != null);
  for (const balanceType of BALANCE_TYPE_PREFERENCE) {
    const match = usable.find((item) => item.balanceType === balanceType);
    if (match?.balanceAmount?.amount != null) return match.balanceAmount.amount;
  }
  // Unknown or absent balanceType: fall back to the first usable entry, as before.
  return usable[0]?.balanceAmount?.amount;
}

const DUPLICATE_ERROR_CODES = new Set(['23505']);

interface SyncTarget {
  appuserRef: number;
  client: BankProvider;
  connection: BankConnectionRef;
  provider: AccountFinancialInstitutionProvider;
  requisitionId: string;
  requisitionKey: number;
}

class AccountInitialSyncAccountService {
  async syncAccountsForRequisition(
    input: { connection: BankConnectionRef; correlationId?: string; queueJobId?: string },
    deps: Deps = {},
  ): Promise<AccountInitialSyncAccountsResult> {
    const em: NonNullable<Deps['em']> = deps.em ?? DI.em;
    const log = deps.logger ?? logger;
    const bg = deps.backgroundOperationService ?? backgroundOperationService;

    const target = this.resolveSyncTarget(input, deps);
    const { appuserRef, client, connection, provider, requisitionId, requisitionKey } = target;

    const tenant = await em.findOne(AppuserTenant, { appuserKey: appuserRef, deletedAt: undefined, recordActive: true }, { populate: ['appuserKey.currencyKey'] });
    if (!tenant) throw new NotFoundError('Active tenant not found for requisition');

    const providerAccounts = await client.listAccounts(connection);
    const accountIds = providerAccounts.accounts.map((account) => account.externalId);
    // The connection itself already carries `institutionId` (it's required to create one), so it's
    // known even when every account below fails before its own balances call, and
    // bank_sync_incident.institution_id is set on account-phase failures too.
    const institutionIds = new Set<string>();
    if (providerAccounts.institutionId) institutionIds.add(providerAccounts.institutionId);
    if (accountIds.length === 0) {
      // Reported, not returned silently, so "the provider returned zero accounts for a requisition
      // our own database still shows as linked" is distinguishable from a per-account fetch failure
      // below. The provider's raw status may be the only signal telling us why.
      log.warn(
        { institutionId: providerAccounts.institutionId, providerStatus: providerAccounts.providerStatus, requisitionId },
        'Account initial sync: provider returned zero accounts for a linked requisition',
      );
      Sentry.captureMessage('Account initial sync: provider returned zero accounts for a linked requisition', {
        extra: { institutionId: providerAccounts.institutionId, providerStatus: providerAccounts.providerStatus },
        level: 'warning',
        tags: { requisitionId, stage: 'account-phase' },
      });
      return {
        accountsCreated: 0,
        accountsFailed: 0,
        accountsFetched: 0,
        accountsTotal: 0,
        accountsUpdated: 0,
        appuserKey: getAppuserKey(appuserRef),
        failedAccountIds: [],
        institutionIds: [...institutionIds],
        requisitionId,
        requisitionKey,
        status: 'failed',
      };
    }

    const fulfilled: { accountId: string; created: boolean; institutionId: string }[] = [];
    const failedAccountIds: string[] = [];
    let rateLimited: ProviderRateLimit | undefined;
    let rejectedCount = 0;
    for (const [index, providerAccount] of providerAccounts.accounts.entries()) {
      const accountId = providerAccount.externalId;
      try {
      const balances = await client.getBalances(connection, accountId);
      const institutionId = providerAccount.institutionId ?? providerAccounts.institutionId ?? '';
      institutionIds.add(institutionId);
      const currencyCode = providerAccount.currency;
      if (!currencyCode) throw new InternalServerError(`Currency not found: ${accountId}`);
      const currency = await em.findOne(Currency, { code: currencyCode });
      if (!currency) throw new InternalServerError(`Currency not found: ${currencyCode}`);

      let institution = await em.findOne(AccountFinancialInstitution, { deletedAt: undefined, id: institutionId });
      if (!institution) {
        institution = em.create(AccountFinancialInstitution, { displayName: institutionId, id: institutionId, logoUrl: undefined, name: institutionId, provider });
        try {
          await em.persist(institution).flush();
        } catch (error) {
          if (!isUniqueConstraintError(error)) throw error;
          institution = await em.findOneOrFail(AccountFinancialInstitution, { deletedAt: undefined, id: institutionId });
        }
      }

      const balanceAmount = selectProviderBalanceAmount({ balances });
      if (balanceAmount === undefined) throw new InternalServerError(`Provider returned no balance for account: ${accountId}`);
      const balance = Number(balanceAmount);
      if (!Number.isFinite(balance)) throw new InternalServerError(`Invalid balance for account: ${accountId}`);
      const existingDeleted = await em.findOne(Account, { accountId, accountOwnerAppuserKey: tenant.appuserKey, deletedAt: { $ne: null } });
      let existingActive = existingDeleted ?? await em.findOne(Account, { accountId, accountOwnerAppuserKey: tenant.appuserKey, deletedAt: undefined });
      // A provider can issue a fresh external accountId per requisition/session, even for
      // what is really the same real-world bank account — so a second, independently-valid
      // requisition for the same institution (double-click on "Connect", a stale redirect
      // retried, a re-triggered consent flow) is invisible to the accountId-keyed lookup above
      // and would create a second Account row, which would then run a second full transaction
      // sync and duplicate every transaction too. When the provider supplies an IBAN, fall back
      // to matching an existing *active* account by (IBAN, owner, institution) before creating a
      // new one, so the later session's sync collapses onto the first account instead of
      // duplicating it. Deliberately scoped to non-deleted accounts only — an account the user
      // explicitly unlinked must not be silently revived by an IBAN match.
      if (!existingActive && providerAccount.iban) {
        existingActive = await em.findOne(Account, {
          accountFinancialInstitutionKey: institution,
          accountNumber: providerAccount.iban,
          accountOwnerAppuserKey: tenant.appuserKey,
          deletedAt: undefined,
        });
      }
      const account = existingActive ?? em.create(Account, { accountId });
      const wasExisting = Boolean(existingActive);
      account.accountId = accountId;
      account.accountOwnerAppuserKey = tenant.appuserKey;
      account.accountName ||= providerAccount.name ?? institutionId;
      account.accountNumber ||= providerAccount.iban ?? undefined;
      // The first balance the provider reports is what the account held when it was linked. Net
      // worth history counts it from then until a transaction carries a running balance. An account
      // that already had a balance before opening balances existed gets one from the startup
      // backfill instead (`backfillAccountOpeningBalances`), which can derive it from its rows.
      if (account.openingBalance == null && account.balance == null) {
        account.openingBalance = balance;
        account.openingBalanceDate = new Date();
      }
      account.balance = balance;
      const converted = await resolveAppuserCurrencyBalance(em, currency, tenant, balance);
      account.appuserCurrencyBalance = converted.amount;
      account.fxStatus = converted.fxStatus;
      account.currencyKey = currency;
      account.accountFinancialInstitutionKey = institution;
      account.bankConnectionKey = connection.bankConnectionKey as unknown as Account['bankConnectionKey'];
      account.tenantKey = tenant.tenantKey;
      account.holderName ||= providerAccount.ownerName;
      account.refreshedAt = new Date();
      // The provider's ISO 20022 cash account type is the one authority on whether this is a card.
      // A provider that says nothing leaves the type as it was, so a user's choice is not cleared.
      if (providerAccount.cashAccountType === 'CARD') {
        const creditCardType = await em.findOne(AccountType, { description: 'CREDIT_CARD' });
        if (creditCardType) account.accountTypeKey = creditCardType;
      }
      if (existingDeleted) existingDeleted.deletedAt = undefined;
      try {
        await em.persist(account).flush();
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const reloaded = await em.findOne(Account, { accountId, accountOwnerAppuserKey: tenant.appuserKey, deletedAt: undefined });
        if (!reloaded) throw error;
        reloaded.accountName = account.accountName;
        reloaded.accountNumber = account.accountNumber;
        reloaded.accountTypeKey = account.accountTypeKey;
        reloaded.balance = account.balance;
        reloaded.appuserCurrencyBalance = account.appuserCurrencyBalance;
        reloaded.fxStatus = account.fxStatus;
        reloaded.currencyKey = account.currencyKey;
        reloaded.accountFinancialInstitutionKey = account.accountFinancialInstitutionKey;
        reloaded.bankConnectionKey = account.bankConnectionKey;
        reloaded.tenantKey = account.tenantKey;
        reloaded.holderName = account.holderName;
        reloaded.refreshedAt = account.refreshedAt;
        await em.persist(reloaded).flush();
      }

      fulfilled.push({ accountId, created: !wasExisting, institutionId });
      } catch (error) {
        failedAccountIds.push(accountId);
        if (isProviderRejection(error)) rejectedCount += 1;
        rateLimited = providerRateLimitOf(error);
        if (rateLimited) {
          // Every further call spends quota the provider has just refused. The accounts not yet
          // visited count as failed, so nothing marks them fresh.
          failedAccountIds.push(...accountIds.slice(index + 1));
          log.warn({ accountId, rateLimited, requisitionId }, 'Account initial sync stopped: provider rate limit');
          break;
        }
        log.warn({ accountId, error: sanitizeError(error), requisitionId }, 'Account initial sync account fetch failed');
        const providerResponse = sanitizeProviderResponse(error);
        Sentry.captureException(error, {
          ...(providerResponse ? { extra: { providerResponse } } : {}),
          tags: { accountId, requisitionId, stage: 'account-phase' },
        });
      }
    }
    const accountsFetched = fulfilled.length;
    const result: AccountInitialSyncAccountsResult = {
      accountsCreated: fulfilled.filter((r) => r.created).length,
      accountsFailed: failedAccountIds.length,
      accountsFetched,
      accountsTotal: accountIds.length,
      accountsUpdated: fulfilled.filter((r) => !r.created).length,
      appuserKey: getAppuserKey(appuserRef),
      failedAccountIds,
      institutionIds: [...institutionIds],
      requisitionId,
      requisitionKey,
      status: accountIds.length === 0 || accountsFetched === 0 ? 'failed' : failedAccountIds.length === 0 ? 'completed' : 'partial',
      ...(accountsFetched === 0 && rejectedCount === accountIds.length ? { everyAccountRejected: true } : {}),
      ...(rateLimited ? { rateLimited } : {}),
    };

    if (input.correlationId && input.queueJobId) {
      await bg.heartbeatJob(input.correlationId, input.queueJobId, { progress: { ...result }, stage: 'account.initial-sync:syncing-accounts' });
    }

    log.info({ requisitionKey, status: result.status }, 'Account initial sync account domain completed');
    return result;
  }

  /**
   * The provider seam. Everything below this point in `syncAccountsForRequisition` reads only
   * the normalized `SyncTarget` fields, never a provider name or entity.
   */
  private resolveSyncTarget(input: { connection: BankConnectionRef }, deps: Deps): SyncTarget {
    if (!deps.provider) throw new InternalServerError('Bank sync provider is not configured');
    if (input.connection.status !== BankConnectionStatus.LINKED) throw new ConflictError('Bank connection is not linked');
    return {
      appuserRef: input.connection.appuserId,
      client: deps.provider,
      connection: input.connection,
      provider: deps.provider.institutionProvider,
      requisitionId: input.connection.externalId,
      requisitionKey: input.connection.bankConnectionKey,
    };
  }
}

function getAppuserKey(appuserKey?: unknown): number {
  if (typeof appuserKey === 'number') return appuserKey;
  if (appuserKey && typeof appuserKey === 'object' && typeof (appuserKey as { appuserKey?: unknown }).appuserKey === 'number') return (appuserKey as { appuserKey: number }).appuserKey;
  return 0;
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

/** The balance in the owner's currency at today's rate; with no rate, none (`missing`), never the raw one. */
async function resolveAppuserCurrencyBalance(em: NonNullable<Deps['em']>, accountCurrency: Currency, tenant: AppuserTenant, balance: number): Promise<FxConversion> {
  const appuserCurrency = (tenant.appuserKey as unknown as undefined | { currencyKey?: Currency })?.currencyKey;
  if (!appuserCurrency) return { amount: null, fxStatus: FxStatus.MISSING, rate: null };
  return convertWithStatus(em as unknown as EntityManager, balance, accountCurrency, appuserCurrency, new Date(), rateScope(tenant.tenantKey));
}

function sanitizeError(error: unknown) {
  if (!error || typeof error !== 'object') return { message: String(error) };
  const safe = error as { code?: unknown; message?: unknown; name?: unknown; status?: unknown };
  return {
    code: typeof safe.code === 'string' ? safe.code : undefined,
    message: typeof safe.message === 'string' ? safe.message : undefined,
    name: typeof safe.name === 'string' ? safe.name : undefined,
    providerResponse: sanitizeProviderResponse(error),
    status: typeof safe.status === 'number' || typeof safe.status === 'string' ? safe.status : undefined,
  };
}

/**
 * An Axios rejection stringifies to "Request failed with status code 409" and nothing more — the
 * provider's own explanation lives on `error.response.data`, so both sinks here attach it: a bare
 * status code is not a diagnosis.
 *
 * The provider answers with a small JSON object, none of whose keys are expected to be
 * sensitive — but this is a bank integration and the body is not under our control, so it
 * goes through `redactSensitiveData` (which blanks `iban`, `account*`, `email`, `token`, … at any
 * depth) and is length-capped before it can reach Sentry. Returns `undefined` when there is no
 * response at all, so a plain `Error` adds no empty scaffolding to the event.
 */

export default new AccountInitialSyncAccountService();
