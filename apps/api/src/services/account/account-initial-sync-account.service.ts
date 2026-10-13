import { UniqueConstraintViolationException } from '@mikro-orm/core';
import * as Sentry from '@sentry/node';

import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { AccountFinancialInstitution, AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Currency } from '@entity/Currency';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { ExchangeRate } from '@entity/ExchangeRate';
import { createEnableBankingSyncAdapter } from '@service/enable-banking/enable-banking-sync-adapter';
import backgroundOperationService from '@service/operations/background-operation.service';
import { sanitizeProviderResponse } from '@utils/error-sanitizer';
import { ConflictError, InternalServerError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';
import { convertMoney } from '@utils/money';

/**
 * `requisitionId`/`requisitionKey` are named for their GoCardless origin but are, as of Phase 1d,
 * provider-agnostic "sync target identity" fields: for an Enable Banking connection they carry
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
  requisitionId: string;
  requisitionKey: number;
  status: 'completed' | 'failed' | 'partial';
}

interface AccountBalanceResponseLike { balances?: { balanceAmount?: { amount?: string }; balanceType?: string }[] }

/**
 * RAD-564: which of the provider's balances becomes `account.balance`, in preference order.
 *
 * The Berlin Group / GoCardless balances array is a *set* of balance types, and the array order is
 * not part of the contract. Taking whichever entry happened to come first meant `account.balance`
 * could silently flip between a booked balance and one that includes pending authorisations,
 * changing by the pending float between two syncs with no transaction to explain it. Since the
 * running-balance chain is now anchored on `account.balance` (see `balance-chain.service.ts`), an
 * anchor that flips type would shift every row on the account, so the choice has to be deterministic.
 *
 * Booked balances first: they are the ones the settled chain can actually reconcile against.
 * Available/expected balances only as a fallback for institutions that publish nothing else.
 */
const BALANCE_TYPE_PREFERENCE = ['closingBooked', 'interimBooked', 'openingBooked', 'expected', 'interimAvailable', 'forwardAvailable', 'nonInvoiced'] as const;

interface BankSyncAccountBalancesResponse { balances?: { balanceAmount?: { amount?: string } }[] }

interface BankSyncAccountDetailsResponse { account?: { currency?: string; name?: string; ownerName?: string } }
interface BankSyncAccountMetadataResponse { iban?: string; institution_id?: string }
interface BankSyncClient {
  account: (accountId: string) => {
    getBalances: () => Promise<BankSyncAccountBalancesResponse>;
    getDetails: () => Promise<BankSyncAccountDetailsResponse>;
    getMetadata: () => Promise<BankSyncAccountMetadataResponse>;
  };
  requisition: { getRequisitionById: (id: string) => Promise<{ accounts?: string[]; institution_id?: string }> };
}
interface Deps {
  backgroundOperationService?: typeof backgroundOperationService;
  em?: {
    create<T>(entityClass: new (...args: never[]) => T, data: Partial<T>): T;
    find<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<T[]>;
    findOne<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>, options?: Record<string, unknown>): Promise<null | T>;
    findOneOrFail<T>(entityClass: new (...args: never[]) => T, where: Record<string, unknown>): Promise<T>;
    persist(entity: unknown): { flush(): Promise<void> };
  };
  // Phase 1d: constructs the Enable Banking shape-adapter (`createEnableBankingSyncAdapter`,
  // already satisfying `BankSyncClient` structurally) for a given connection. Injectable so tests
  // never need a real Enable Banking client/credential.
  enableBankingSyncAdapterFactory?: (connection: EnableBankingConnection) => Promise<BankSyncClient>;
  logger?: Pick<typeof logger, 'error' | 'info' | 'warn'>;
}

export function selectProviderBalanceAmount(response: AccountBalanceResponseLike): string {
  const usable = (response.balances ?? []).filter((item) => item.balanceAmount?.amount != null);
  for (const balanceType of BALANCE_TYPE_PREFERENCE) {
    const match = usable.find((item) => item.balanceType === balanceType);
    if (match?.balanceAmount?.amount != null) return match.balanceAmount.amount;
  }
  // Unknown or absent balanceType: fall back to the first usable entry, as before.
  return usable[0]?.balanceAmount?.amount ?? '0';
}

const DUPLICATE_ERROR_CODES = new Set(['23505']);

interface SyncTarget {
  appuserRef: unknown;
  client: BankSyncClient;
  connection?: EnableBankingConnection;
  provider: AccountFinancialInstitutionProvider;
  requisitionId: string;
  requisitionKey: number;
}

class AccountInitialSyncAccountService {
  async syncAccountsForRequisition(
    input: { correlationId?: string; enableBankingConnectionKey: number; queueJobId?: string },
    deps: Deps = {},
  ): Promise<AccountInitialSyncAccountsResult> {
    const em = deps.em ?? (DI.em as NonNullable<Deps['em']>);
    const log = deps.logger ?? logger;
    const bg = deps.backgroundOperationService ?? backgroundOperationService;

    const target = await this.resolveSyncTarget(em, input, deps);
    const { appuserRef, client, provider, requisitionId, requisitionKey } = target;

    const tenant = await em.findOne(AppuserTenant, { appuserKey: appuserRef, deletedAt: undefined, recordActive: true }, { populate: ['appuserKey.currencyKey'] });
    if (!tenant) throw new NotFoundError('Active tenant not found for requisition');

    const requisitionData = await client.requisition.getRequisitionById(requisitionId);
    const accountIds = requisitionData.accounts ?? [];
    // The requisition itself already carries `institution_id` (it's required to create one), so it's
    // known even when every account below fails before its own getMetadata() call — the only prior
    // source of institution info, which is why bank_sync_incident.institution_id was null on every
    // account-phase failure (RAD-519).
    const institutionIds = new Set<string>();
    if (requisitionData.institution_id) institutionIds.add(requisitionData.institution_id);
    if (accountIds.length === 0) {
      // RAD-519: this used to return silently — no log, no Sentry event, nothing to distinguish
      // "the provider returned zero accounts for a requisition our own database still shows as
      // linked" from a per-account fetch failure below. `status` isn't in the local requisition
      // type (only `accounts`/`institution_id` are declared), but the real Berlin Group response
      // carries richer values than our simplified CR/LN (e.g. a bank-required re-authentication
      // state) — read it defensively since it may be the only signal telling us why.
      const rawStatus = (requisitionData as { status?: unknown }).status;
      log.warn(
        { institutionId: requisitionData.institution_id, providerStatus: typeof rawStatus === 'string' ? rawStatus : undefined, requisitionId },
        'Account initial sync: provider returned zero accounts for a linked requisition',
      );
      Sentry.captureMessage('Account initial sync: provider returned zero accounts for a linked requisition', {
        extra: { institutionId: requisitionData.institution_id, providerStatus: typeof rawStatus === 'string' ? rawStatus : undefined },
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
    for (const accountId of accountIds) {
      try {
      const [detailsResponse, metadata, balances] = await Promise.all([
        client.account(accountId).getDetails(),
        client.account(accountId).getMetadata(),
        client.account(accountId).getBalances(),
      ]);
      const details = detailsResponse.account as { currency?: string; name?: string; ownerName?: string };
      const metadataInfo = metadata as Partial<{ iban?: string; institution_id?: string }>;
      const institutionId = metadataInfo.institution_id ?? '';
      institutionIds.add(institutionId);
      if (!details.currency) throw new InternalServerError(`Currency not found: ${accountId}`);
      const currency = await em.findOne(Currency, { code: details.currency });
      if (!currency) throw new InternalServerError(`Currency not found: ${details.currency}`);

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

      const balanceAmount = selectProviderBalanceAmount(balances as AccountBalanceResponseLike);
      const balance = Number(balanceAmount);
      if (!Number.isFinite(balance)) throw new InternalServerError(`Invalid balance for account: ${accountId}`);
      const existingDeleted = await em.findOne(Account, { accountId, accountOwnerAppuserKey: tenant.appuserKey, deletedAt: { $ne: null } });
      let existingActive = existingDeleted ?? await em.findOne(Account, { accountId, accountOwnerAppuserKey: tenant.appuserKey, deletedAt: undefined });
      // RAD-631: GoCardless issues a fresh external accountId per requisition/session, even for
      // what is really the same real-world bank account — so a second, independently-valid
      // requisition for the same institution (double-click on "Connect", a stale redirect
      // retried, a re-triggered consent flow) is invisible to the accountId-keyed lookup above
      // and previously created a second Account row, which then ran a second full transaction
      // sync and duplicated every transaction too. When the provider supplies an IBAN, fall back
      // to matching an existing *active* account by (IBAN, owner, institution) before creating a
      // new one, so the later session's sync collapses onto the first account instead of
      // duplicating it. Deliberately scoped to non-deleted accounts only — an account the user
      // explicitly unlinked must not be silently revived by an IBAN match.
      if (!existingActive && metadataInfo.iban) {
        existingActive = await em.findOne(Account, {
          accountFinancialInstitutionKey: institution,
          accountNumber: metadataInfo.iban,
          accountOwnerAppuserKey: tenant.appuserKey,
          deletedAt: undefined,
        });
      }
      const account = existingActive ?? em.create(Account, { accountId });
      const wasExisting = Boolean(existingActive);
      account.accountId = accountId;
      account.accountOwnerAppuserKey = tenant.appuserKey;
      account.accountName ||= details.name ?? institutionId;
      account.accountNumber ||= metadataInfo.iban ?? undefined;
      account.balance = balance;
      account.appuserCurrencyBalance = await resolveAppuserCurrencyBalance(em, currency, tenant, balance);
      account.currencyKey = currency;
      account.accountFinancialInstitutionKey = institution;
      account.enableBankingConnectionKey = target.connection;
      account.tenantKey = tenant.tenantKey;
      account.holderName ||= details.ownerName;
      account.refreshedAt = new Date();
      if (existingDeleted) existingDeleted.deletedAt = undefined;
      try {
        await em.persist(account).flush();
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const reloaded = await em.findOne(Account, { accountId, accountOwnerAppuserKey: tenant.appuserKey, deletedAt: undefined });
        if (!reloaded) throw error;
        reloaded.accountName = account.accountName;
        reloaded.accountNumber = account.accountNumber;
        reloaded.balance = account.balance;
        reloaded.appuserCurrencyBalance = account.appuserCurrencyBalance;
        reloaded.currencyKey = account.currencyKey;
        reloaded.accountFinancialInstitutionKey = account.accountFinancialInstitutionKey;
        reloaded.enableBankingConnectionKey = account.enableBankingConnectionKey;
        reloaded.tenantKey = account.tenantKey;
        reloaded.holderName = account.holderName;
        reloaded.refreshedAt = account.refreshedAt;
        await em.persist(reloaded).flush();
      }

      fulfilled.push({ accountId, created: !wasExisting, institutionId });
      } catch (error) {
        failedAccountIds.push(accountId);
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
    };

    if (input.correlationId && input.queueJobId) {
      await bg.heartbeatJob(input.correlationId, input.queueJobId, { progress: { ...result }, stage: 'account.initial-sync:syncing-accounts' });
    }

    log.info({ requisitionKey, status: result.status }, 'Account initial sync account domain completed');
    return result;
  }

  /**
   * Phase 1d client-construction seam: the only place that branches on which provider owns this
   * sync. Everything below this point in `syncAccountsForRequisition` reads only the normalized
   * `SyncTarget` fields (plus the two provider-specific FK assignments explicitly called out
   * inline), never `NordigenRequisition`/`EnableBankingConnection` directly — see plan §3/§4 and
   * `enable-banking-sync-adapter.ts`'s module docblock for why the client itself never has to
   * change shape.
   */
  private async resolveSyncTarget(
    em: NonNullable<Deps['em']>,
    input: { enableBankingConnectionKey?: number },
    deps: Deps,
  ): Promise<SyncTarget> {
    if (input.enableBankingConnectionKey == null) throw new ConflictError('Bank sync requires an Enable Banking connection');
    {
      const connection = await em.findOne(EnableBankingConnection, { deletedAt: undefined, enableBankingConnectionKey: input.enableBankingConnectionKey });
      if (!connection) throw new NotFoundError('Enable Banking connection not found');
      if (connection.status !== EnableBankingConnectionStatus.LINKED) throw new ConflictError('Enable Banking connection is not linked');
      const client = await (deps.enableBankingSyncAdapterFactory ?? defaultEnableBankingSyncAdapterFactory)(connection);
      return {
        appuserRef: connection.appuserKey,
        client,
        connection,
        provider: AccountFinancialInstitutionProvider.ENABLE_BANKING,
        // Enable Banking has no requisition-style opaque id post-link; `sessionId` is the closest
        // provider-issued identity, falling back to the pre-link correlation `state` if a sync is
        // somehow attempted before a session exists (defensive — shouldn't happen, see
        // `EnableBankingConnectionStatus.LINKED` guard above).
        requisitionId: connection.sessionId ?? connection.state,
        requisitionKey: connection.enableBankingConnectionKey,
      };
    }

  }
}

/**
 * Lazily decrypts the connection's own credential and builds the Phase 1b/1d client chain.
 * The cast is a shape-compatibility formality, not a behavioral one: `EnableBankingSyncClient`
 * and this file's local `BankSyncClient` describe the same runtime contract (see
 * `enable-banking-sync-adapter.ts`'s docblock) but were declared independently, so their optional
 * fields don't structurally unify.
 */

function defaultEnableBankingSyncAdapterFactory(connection: EnableBankingConnection): Promise<BankSyncClient> {
  return Promise.resolve(createEnableBankingSyncAdapter(connection) as unknown as BankSyncClient);
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

async function resolveAppuserCurrencyBalance(em: NonNullable<Deps['em']>, accountCurrency: Currency, tenant: AppuserTenant, balance: number) {
  const appuserCurrency = (tenant.appuserKey as unknown as undefined | { currencyKey?: Currency })?.currencyKey;
  if (!appuserCurrency || appuserCurrency.code === accountCurrency.code) return balance;
  const exchangeRate = await em.findOne(ExchangeRate, { date: { $lte: new Date() }, fromCurrency: accountCurrency, toCurrency: appuserCurrency }, { orderBy: { date: 'DESC', toCurrency: 'ASC' } });
  if (!exchangeRate?.rate) return undefined;
  return convertMoney(balance, exchangeRate.rate);
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
 * provider's own explanation lives on `error.response.data` and was previously discarded by both
 * sinks here. That is how API-W6 accumulated 573 events across four users with no way to tell why
 * GoCardless was refusing: a bare status code is not a diagnosis.
 *
 * GoCardless answers with a small JSON object (`summary` / `detail` / `status_code`), none of whose
 * keys are sensitive — but this is a bank integration and the body is not under our control, so it
 * goes through `redactSensitiveData` (which blanks `iban`, `account*`, `email`, `token`, … at any
 * depth) and is length-capped before it can reach Sentry. Returns `undefined` when there is no
 * response at all, so a plain `Error` adds no empty scaffolding to the event.
 */

export default new AccountInitialSyncAccountService();
