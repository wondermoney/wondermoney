import crypto from 'node:crypto';

import { type EntityData, type EntityManager, type FilterQuery, UniqueConstraintViolationException } from '@mikro-orm/core';
import * as Sentry from '@sentry/node';
import { generateInternalTransactionId } from '@wondermoney/shared';

import { DI } from '@app/database/di';
import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Currency } from '@entity/Currency';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { ExchangeRate } from '@entity/ExchangeRate';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionStatus } from '@entity/TransactionStatus';
import { TransactionType } from '@entity/TransactionType';
import { createEnableBankingSyncAdapter, type StableIdFields } from '@service/enable-banking/enable-banking-sync-adapter';
import backgroundOperationService from '@service/operations/background-operation.service';
import type { Enqueue } from '@service/queue/enqueue';
import { triggerRecurringDetectionAfterTransactionIngestion } from '@service/recurring/post-transaction-ingestion-detection.service';
import { enqueueTransactionEnrichmentForTenant } from '@service/transaction-enrichment/transaction-enrichment-enqueue.service';
import { recalculateChainFromAccountBalance } from '@service/transaction/balance-chain.service';
import { applyCategorizationOutcome } from '@service/transaction/categorization-confidence';
import { DEFAULT_PENDING_GRACE_DAYS, logDryRunExpirations, planPendingExpirations } from '@service/transaction/pending-expiry.service';
import { getReconciliationMode, logDryRunPromotions, planPromotions } from '@service/transaction/pending-reconciliation.service';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { findExistingTransaction, findExistingTransactionWithProvenance } from '@service/transaction/transaction-dedup.service';
import deterministicCategorizationService from '@service/transaction/transaction-deterministic-categorization.service';
import { enrichTransactionMetadata, isTransactionMetadataEnrichmentEnabled } from '@service/transaction/transaction-metadata-enrichment.service';
import { reconcileTransfers } from '@service/transaction/transfer-matching.service';
import { sanitizeProviderResponse } from '@utils/error-sanitizer';
import { InternalServerError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';
import { convertMoney, roundMoney, toNumber } from '@utils/money';

/** See the identical note in `account-initial-sync-account.service.ts` — `requisitionId`/
 * `requisitionKey` are provider-agnostic sync-target identity fields. */
export interface AccountInitialSyncTransactionsResult { accountsFailed: number; accountsProcessed: number; accountsTotal: number; appuserKey: number; failedAccountIds: string[]; requisitionId: string; requisitionKey: number; status: 'completed' | 'failed' | 'partial'; transactionsCategorized: number; transactionsCreated: number; transactionsFailed: number; transactionsFetched: number; transactionsSkipped: number; }

interface BankSyncClient { account: (accountId: string) => { getTransactions: (input?: { country?: string; dateFrom?: string; dateTo?: string }) => Promise<BankSyncTransactionsResponse> }; }
/** Berlin-Group-shaped transaction row. Both bank providers normalise into this shape;
 * declared locally so the app carries no dependency on any provider SDK's types. */
export interface BankSyncTransaction { amount?: string; bookingDate?: string; creditDebitIndicator?: string; creditorName?: string; creditorReference?: string; currency?: string; currencyExchange?: { exchangeRate?: number | string; instructedAmount?: { amount?: string; currency?: string }; sourceCurrency?: string }; debtorName?: string; entryReference?: string; internalTransactionId?: string; providerStatus?: string; remittanceInformationStructured?: string; remittanceInformationUnstructured?: string; stableIdFields?: StableIdFields; transactionAmount?: { amount?: string; currency?: string }; transactionDate?: string; transactionId?: string; valueDate?: string }
/** `voided`: rows the provider reports as rejected or cancelled. Never ingested; used only to retract a stored copy. */
interface BankSyncTransactionsResponse { transactions?: { booked?: BankSyncTransaction[]; pending?: BankSyncTransaction[]; voided?: BankSyncTransaction[] } }
interface Deps { backgroundOperationService?: typeof backgroundOperationService; em?: EntityManager; enableBankingSyncAdapterFactory?: (connection: EnableBankingConnection) => Promise<BankSyncClient>; enqueue?: Enqueue; logger?: Pick<typeof logger, 'error' | 'info' | 'warn'>;  }

/** Client-construction seam — see the identical-purpose `SyncTarget` in
 * `account-initial-sync-account.service.ts` for the full rationale. */
interface SyncTarget { appuserRef: Appuser; client: BankSyncClient; enableBanking: boolean; requisitionId: string; requisitionKey: number; }

const DUPLICATE_ERROR_CODES = new Set(['23505']);
/** What a row outside the running-balance chain carries (PENDING, EXPIRED). */
const NO_RUNNING_BALANCE = { appuserCurrencyBalance: null, balance: null } as const;
/** Sync reads see the rows a user hid: hiding a transaction changes where it shows, not what it is. */
const INCLUDE_HIDDEN = { includeHidden: true } as const;

class AccountInitialSyncTransactionService {
  async syncTransactionsForRequisition(
    input: { correlationId?: string; enableBankingConnectionKey: number; fetchWindowDays?: number; queueJobId?: string },
    deps: Deps = {},
  ): Promise<AccountInitialSyncTransactionsResult> {
    const em = deps.em ?? DI.em;
    const log = deps.logger ?? logger;
    const bg = deps.backgroundOperationService ?? backgroundOperationService;
    const metadataEnrichmentEnabled = isTransactionMetadataEnrichmentEnabled();

    const target = await this.resolveSyncTarget(em, input, deps);
    const { appuserRef, client, enableBanking, requisitionId, requisitionKey } = target;

    const tenant = await em.findOne(AppuserTenant, { appuserKey: appuserRef, deletedAt: undefined, recordActive: true }, { populate: ['appuserKey.currencyKey'] });
    if (!tenant) throw new NotFoundError('Active tenant not found for requisition');

    const accounts = await em.find(Account, { deletedAt: undefined, enableBankingConnectionKey: input.enableBankingConnectionKey } as FilterQuery<Account>);
    if (accounts.length === 0) return this.emptyResult(requisitionId, requisitionKey, appuserRef);

    const txnStatusBooked = await this.findTransactionStatus(em, ['BOOKED']);
    const txnStatusPending = await this.findTransactionStatus(em, ['PENDING']);
    const txnStatusExpired = await this.findTransactionStatus(em, ['EXPIRED']);
    const reconciliationMode = getReconciliationMode();
    const transactionTypes = await this.loadTransactionTypes(em);
    const settledStatusByName = { BOOKED: txnStatusBooked, PENDING: txnStatusPending };

    let transactionsCreated = 0; let transactionsCategorized = 0; let transactionsFetched = 0; let transactionsFailed = 0; let transactionsSkipped = 0;
    const failedAccountIds: string[] = []; const processedAccountIds = new Set<string>(); const affectedTenantKeys = new Set<number>();
    for (const account of accounts) {
      let accountCreated = 0; let accountFailed = 0; let accountSkipped = 0;
      try {
        const response = await client.account(account.accountId ?? '').getTransactions({ country: '', dateFrom: dateOffset(new Date(), input.fetchWindowDays ?? 365), dateTo: isoDate(new Date()) });
        const transactions = response.transactions;
        const booked = transactions?.booked ?? [];
        const pending = transactions?.pending ?? [];
        // A rejected or cancelled row is never ingested, and a stored copy (e.g. a legacy row stored
        // as booked) is retracted. Before promotions, so a voided pending can
        // never be promoted by an unrelated booked row of the same amount.
        if (txnStatusExpired) await this.applyVoids(em, account, transactions?.voided ?? [], txnStatusExpired, enableBanking);
        // Pending→posted reconciliation. `apply` promotes/expires in place (live);
        // `dry_run` only logs intended changes. Off = kill switch. Always before the persist loop so a
        // promoted pending is then found by provider-id dedup and updated (never duplicated).
        if (reconciliationMode !== 'off' && txnStatusPending) {
          const seenPendingIdentities = new Set<string>();
          // An id-less Enable Banking pending is stored under its stable hash, so that hash is one
          // of its identities too; without it a pending still in the feed would expire after the grace window.
          for (const row of pending) { const tx = row as Partial<BankSyncTransaction>; for (const id of [tx.transactionId, tx.internalTransactionId, tx.entryReference, enableBanking ? this.buildStableId(account.accountId ?? String(account.accountKey), row, 'enable_banking') : undefined]) if (id) seenPendingIdentities.add(id); }
          if (reconciliationMode === 'apply') {
            const promotedKeys = await this.applyPromotions(em, account, tenant, booked, { expired: txnStatusExpired, pending: txnStatusPending }, seenPendingIdentities, enableBanking);
            if (txnStatusExpired) await this.applyExpirations(em, account, txnStatusPending, txnStatusExpired, seenPendingIdentities, promotedKeys);
          } else {
            const bookedMatchables = booked
              .map((row) => { const tx = row as Partial<BankSyncTransaction>; return { counterparty: tx.creditorName ?? tx.debtorName ?? undefined, currencyCode: tx.transactionAmount?.currency ?? tx.currency ?? '', settlementAmount: Number(tx.transactionAmount?.amount ?? tx.amount), transactionDate: rowDate(tx) }; })
              .filter((matchable) => Number.isFinite(matchable.settlementAmount) && !Number.isNaN(matchable.transactionDate.getTime()));
            await logDryRunPromotions(em, { account, bookedRows: bookedMatchables, pendingStatus: txnStatusPending, tenant });
            await logDryRunExpirations(em, { account, pendingStatus: txnStatusPending, seenIdentities: seenPendingIdentities });
          }
        }
        const rows: { pending: boolean; row: BankSyncTransaction }[] = [...pending.map((row) => ({ pending: true, row })), ...booked.map((row) => ({ pending: false, row }))];
        transactionsFetched += rows.length;
        for (const item of rows) {
          const mapped = await this.persistTransaction(em, account, tenant, item.row, item.pending, settledStatusByName, transactionTypes, metadataEnrichmentEnabled, enableBanking);
          accountCreated += mapped.created; accountSkipped += mapped.skipped; accountFailed += mapped.failed; transactionsCategorized += mapped.categorized ?? 0; if (mapped.created > 0 && mapped.tenantKey) affectedTenantKeys.add(mapped.tenantKey);
        }
        // The running balance is a chain over the whole account, not a per-batch suffix.
        // Persisting the batch above leaves the newly created rows without a balance and the rows it
        // updated with a stale one, so the chain is rebuilt here — every settled row on the account,
        // in `(transactionDate, transactionKey)` order, anchored on the provider's `account.balance`.
        //
        // Runs even when the batch is empty, and that is the point of putting it here: the account
        // phase has just written a fresh provider balance, so an idle account whose chain ends on the
        // *previous* balance is exactly the case where `account.balance` and the top of the
        // transactions list would silently disagree. Inside the try so a failure marks the account failed
        // rather than leaving a half-written chain.
        const { changed: rewritten } = await recalculateChainFromAccountBalance(em, account);
        if (rewritten > 0) log.info({ accountId: account.accountId, rewritten }, 'Rebuilt account running-balance chain');
        if (rows.length === 0) { processedAccountIds.add(account.accountId ?? String(account.accountKey)); continue; }
        if (input.correlationId && input.queueJobId) await bg.heartbeatJob(input.correlationId, input.queueJobId, { progress: { accountsProcessed: processedAccountIds.size, accountsTotal: accounts.length, failedAccountIds, transactionsCategorized, transactionsCreated, transactionsFailed, transactionsFetched, transactionsSkipped }, stage: 'account.initial-sync:syncing-transactions' });
      } catch (error) {
        failedAccountIds.push(account.accountId ?? String(account.accountKey)); transactionsFailed += 1;
        log.warn({ accountId: account.accountId, error: sanitizeError(error) }, 'Account initial sync transaction fetch failed');
        // This only ever logged, so the 48-incident data_validation cluster had no Sentry
        // event to investigate from — matching account-initial-sync-account.service.ts's per-account
        // catch, which does report.
        const providerResponse = sanitizeProviderResponse(error);
        Sentry.captureException(error, {
          ...(providerResponse ? { extra: { providerResponse } } : {}),
          tags: { accountId: account.accountId, requisitionId, stage: 'transaction-phase' },
        });
        continue;
      }
      transactionsCreated += accountCreated; transactionsSkipped += accountSkipped; transactionsFailed += accountFailed;
      // A fetch that only updated rows already stored (created and skipped both 0) is as fresh
      // as one that created rows; freshness says the bank answered, not that it had something new.
      if (accountFailed > 0) failedAccountIds.push(account.accountId ?? String(account.accountKey)); else processedAccountIds.add(account.accountId ?? String(account.accountKey));
    }

    // A credit is stored as income (DEPOSIT). Pair the ones that are the other half of a
    // transfer between two of the household's accounts, over the window this sync fetched. On its own
    // forked EM in one transaction: a failure (a concurrent sync pairing the same rows hits the unique
    // counterpart constraint) rolls back whole and leaves nothing dirty for the sync's later flushes.
    // Best-effort: matching never fails the sync; the next sync matches again.
    if (processedAccountIds.size > 0) {
      try {
        const matched = await em.fork().transactional((tx) => reconcileTransfers(tx, { actorType: TransactionAuditActorType.SYNC, apply: true, from: new Date(dateOffset(new Date(), input.fetchWindowDays ?? 365)), source: 'transfer-matching', tenantKey: tenant.tenantKey.tenantKey }));
        if (matched.rowsChanged > 0) log.info({ ...matched, tenantKey: tenant.tenantKey.tenantKey }, 'Matched own-account transfers');
      } catch (error) {
        log.warn({ error: sanitizeError(error) }, 'Transfer matching failed');
      }
    }

    // Mark successfully-synced accounts fresh so the accounts DTO can derive staleness.
    // An account is in `processedAccountIds` when its fetch succeeded and none of its rows failed to
    // persist, whether the fetch created rows, updated stored ones or held none. A failed fetch
    // never gets here. Best-effort — a freshness-marker write must never fail the sync it describes.
    const refreshedAccounts = accounts.filter((account) => processedAccountIds.has(account.accountId ?? String(account.accountKey)));
    if (refreshedAccounts.length > 0) {
      const refreshedAt = new Date();
      for (const account of refreshedAccounts) account.transactionsRefreshedAt = refreshedAt;
      try {
        await em.persist(refreshedAccounts).flush();
      } catch (error) {
        log.warn({ error: sanitizeError(error) }, 'Failed to advance account transactions-refreshed marker');
      }
    }

    for (const tenantKey of affectedTenantKeys) await triggerRecurringDetectionAfterTransactionIngestion(tenantKey, 'account-initial-sync');
    // Best-effort, fail-open shadow enrichment enqueue. Dormant by default; never blocks sync.
    for (const tenantKey of affectedTenantKeys) await enqueueTransactionEnrichmentForTenant(tenantKey, 'account-initial-sync', { enqueue: deps.enqueue });
    const status = failedAccountIds.length === accounts.length ? 'failed' : failedAccountIds.length > 0 ? 'partial' : 'completed';
    return { accountsFailed: failedAccountIds.length, accountsProcessed: processedAccountIds.size, accountsTotal: accounts.length, appuserKey: getAppuserKey(appuserRef), failedAccountIds, requisitionId, requisitionKey, status, transactionsCategorized, transactionsCreated, transactionsFailed, transactionsFetched, transactionsSkipped };
  }

  /** See `account-initial-sync-account.service.ts`'s identical-purpose `resolveSyncTarget`. */
  private buildGeneratedInternalTransactionId(row: BankSyncTransaction) { const transaction = row as Partial<BankSyncTransaction>; const amount = Number(transaction.transactionAmount?.amount ?? transaction.amount); const date = rowDate(transaction); if (!Number.isFinite(amount) || Number.isNaN(date.getTime())) return undefined; try { return generateInternalTransactionId(date, amount); } catch { return undefined; } }

  // An id-less row's hash is its stored identity; see the module-level `buildStableId`.
  private buildStableId(accountId: string, row: BankSyncTransaction, prefix: 'enable_banking' | 'nordigen' = 'nordigen') { return buildStableId(accountId, row, prefix); }
  private buildTransactionMetadata(row: BankSyncTransaction, enabled: boolean) { const transaction = row as Partial<BankSyncTransaction>; const dirty = sanitizeDirty(transaction.remittanceInformationUnstructured ?? transaction.remittanceInformationStructured); if (!enabled) return { descriptionDirty: dirty }; const enrichment = enrichTransactionMetadata({ creditDebitIndicator: transaction.creditDebitIndicator, creditorName: transaction.creditorName, debtorName: transaction.debtorName, descriptionDirty: dirty, remittanceInformationStructured: transaction.remittanceInformationStructured, remittanceInformationUnstructured: transaction.remittanceInformationUnstructured }); return { description: enrichment.descriptionDirty, descriptionDirty: enrichment.descriptionDirty }; }
  private async categorizeIfEnabled(em: EntityManager, appuser: Appuser, transaction: Transaction) {
    // Categorization is on by default; the categorizer itself is the single enable/disable gate.
    try {
      const result = await deterministicCategorizationService.categorizeTransactionDeterministically({ appuser, transaction }, { em });
      applyCategorizationOutcome(transaction, result.reason);
      await em.flush();
      return result.assigned ? 1 : 0;
    } catch (error) {
      logger.warn({ error: sanitizeError(error) }, 'Deterministic categorization failed');
    }
    return 0;
  }
  private emptyResult(requisitionId: string, requisitionKey: number, appuserRef: Appuser): AccountInitialSyncTransactionsResult { return { accountsFailed: 0, accountsProcessed: 0, accountsTotal: 0, appuserKey: getAppuserKey(appuserRef), failedAccountIds: [], requisitionId, requisitionKey, status: 'failed', transactionsCategorized: 0, transactionsCreated: 0, transactionsFailed: 0, transactionsFetched: 0, transactionsSkipped: 0 }; }
  private async findAppuserExchangeRate(em: EntityManager, fromCurrency: Currency, toCurrency?: Currency, date?: Date) { if (!toCurrency || fromCurrency.code === toCurrency.code) return undefined; const queryDate = date ?? new Date(); return em.findOne(ExchangeRate, { date: { $lte: queryDate }, fromCurrency, toCurrency }, { orderBy: { date: 'DESC', toCurrency: 'ASC' } }); }
  private async findTransactionStatus(em: EntityManager, names: string[]) { for (const name of names) { const status = await em.findOne(TransactionStatus, { name }); if (status) return status; } return null; }
  private async loadTransactionTypes(em: EntityManager) { const names = ['TRANSFER_IN', 'TRANSFER_OUT', 'PAYMENT', 'CARD_PAYMENT', 'DEPOSIT', 'TOPUP', 'FEE']; const out = new Map<string, TransactionType>(); for (const name of names) { const type = await em.findOne(TransactionType, { name }); if (type) out.set(name, type); } return out; }
  private async resolveSyncTarget(
    em: EntityManager,
    input: { enableBankingConnectionKey?: number },
    deps: Deps,
  ): Promise<SyncTarget> {
    if (input.enableBankingConnectionKey == null) {
      throw new InternalServerError('Bank sync requires an Enable Banking connection');
    }
    const connection = await em.findOne(EnableBankingConnection, { deletedAt: undefined, enableBankingConnectionKey: input.enableBankingConnectionKey });
    if (!connection) throw new NotFoundError('Enable Banking connection not found');
    if (connection.status !== EnableBankingConnectionStatus.LINKED) throw new InternalServerError('Enable Banking connection is not linked');
    // Cast is a shape-compatibility formality — see the identical note in
    // `account-initial-sync-account.service.ts`'s `defaultEnableBankingSyncAdapterFactory`.
    const client = await (deps.enableBankingSyncAdapterFactory ?? ((c: EnableBankingConnection) => Promise.resolve(createEnableBankingSyncAdapter(c) as unknown as BankSyncClient)))(connection);
    return { appuserRef: connection.appuserKey, client, enableBanking: true, requisitionId: connection.sessionId ?? connection.state, requisitionKey: connection.enableBankingConnectionKey };
  }
  // This does not write `balance` / `appuserCurrencyBalance`. Those are owned by the
  // whole-account chain rebuild that runs once per account after the persist loop — a batch cannot
  // know a row's position in the account's total order.
  // Leaving them out of `common` also means an in-place update never clobbers a good stored balance
  // with `undefined` if the rebuild later fails.
  private async persistTransaction(em: EntityManager, account: Account, tenant: AppuserTenant, row: BankSyncTransaction, pending: boolean, statuses: Record<'BOOKED' | 'PENDING', null | TransactionStatus>, types: Map<string, TransactionType>, metadataEnrichmentEnabled: boolean, enableBanking = false): Promise<{ categorized?: number; created: number; failed: number; skipped: number; tenantKey?: number }> {
    const tx = row as Partial<BankSyncTransaction>; const settlementCurrencyCode = tx.transactionAmount?.currency ?? tx.currency; if (!settlementCurrencyCode) return { created: 0, failed: 1, skipped: 0 };
    const currency = await em.findOne(Currency, { code: settlementCurrencyCode }); if (!currency) return { created: 0, failed: 1, skipped: 0 };
    const status = pending ? statuses.PENDING : statuses.BOOKED; if (!status) return { created: 0, failed: 1, skipped: 0 };
    const type = this.resolveType(row, types); if (!type) return { created: 0, failed: 1, skipped: 0 };
    const settlementAmountRaw = tx.transactionAmount?.amount ?? tx.amount; const amount = Number(settlementAmountRaw); if (!Number.isFinite(amount)) return { created: 0, failed: 1, skipped: 0 };
    const date = rowDate(tx); if (Number.isNaN(date.getTime())) return { created: 0, failed: 1, skipped: 0 };
    const externalTransactionId = tx.transactionId;
    // Enable Banking rows get their own `enableBankingTransactionId` column — the legacy
    // `nordigenInternalTransactionId` column and its dedup branch are untouched for these rows.
    // The id is the `entry_reference` when there is one; see `enableBankingTransactionIdFor`.
    const accountId = account.accountId ?? String(account.accountKey);
    const stableId = this.buildStableId(accountId, row, enableBanking ? 'enable_banking' : 'nordigen');
    const nordigenInternalTransactionId = enableBanking ? undefined : (tx.internalTransactionId ?? tx.transactionId ?? tx.entryReference ?? stableId);
    const enableBankingTransactionId = enableBanking ? enableBankingTransactionIdFor(accountId, row) : undefined;
    const generatedInternalTransactionId = this.buildGeneratedInternalTransactionId(row);
    const internalTransactionId = generatedInternalTransactionId ?? nordigenInternalTransactionId ?? enableBankingTransactionId;
    // Shared dedup — the same deterministic identity check everywhere.
    // Use the provenance variant so we can emit a DEDUP_SKIPPED audit row indicating
    // *which* identity branch matched (external / nordigen / internal). The `internal` branch
    // matching on a row with a *different* bank id is the false-positive-skip case that
    // needs telemetry.
    //
    // Hidden rows: the lookup includes rows the user hid. A hidden row is still the stored copy
    // of this transaction: it is refreshed like any other (status, date, ids, metadata; a user's
    // edited amount kept) and stays hidden, because `common` carries no `hidden`, `reviewed` or
    // category. Through the hidden filter the sync could not see it: a same-id insert would hit the
    // unique constraint and the row would never be refreshed, and a legacy-keyed one would be stored
    // a second time, visible.
    //
    // An Enable Banking row is never matched on `externalTransactionId`. That column holds the
    // `transaction_id`, which the provider says may change between fetches, so it can name another
    // transaction on the next one. Legacy rows stored under it are found by
    // `findEnableBankingTransaction`, which checks that the stored row is the same transaction.
    const existingMatch: null | { existing: Transaction; matchedOn: string } = enableBanking
      ? await findEnableBankingTransaction(accountId, row, currency, (id) => findExistingTransaction(em, { accountKey: account, enableBankingTransactionId: id, internalTransactionId: generatedInternalTransactionId }, INCLUDE_HIDDEN))
      : await findExistingTransactionWithProvenance(em, { accountKey: account, externalTransactionId, internalTransactionId: generatedInternalTransactionId, nordigenInternalTransactionId }, INCLUDE_HIDDEN);
    const existing = existingMatch?.existing ?? null;
    const appuser = tenant.appuserKey;
    const appuserCurrency = appuser.currencyKey;
    const appuserCurrencyCode = appuserCurrency.code;
    const sameCurrency = appuserCurrencyCode === currency.code;
    const rate = sameCurrency ? undefined : await this.findAppuserExchangeRate(em, currency, appuserCurrency, date);
    const settlementExchangeRate = tx.currencyExchange?.exchangeRate != null ? Number(tx.currencyExchange.exchangeRate) : undefined;
    const instructedAmount = tx.currencyExchange?.instructedAmount;
    const originalCurrencyCode = instructedAmount?.currency ?? tx.currencyExchange?.sourceCurrency ?? (settlementExchangeRate && tx.currencyExchange?.sourceCurrency && tx.currencyExchange.sourceCurrency !== currency.code ? tx.currencyExchange.sourceCurrency : undefined);
    const originalCurrencyKey = originalCurrencyCode ? await em.findOne(Currency, { code: originalCurrencyCode }) : currency;
    const originalAmount = instructedAmount?.amount != null
      ? Number(instructedAmount.amount)
      : settlementExchangeRate && tx.currencyExchange?.sourceCurrency && tx.currencyExchange.sourceCurrency !== currency.code
        ? Number(settlementAmountRaw) * settlementExchangeRate
        : Number(settlementAmountRaw);
    const appuserSettlementAmount = sameCurrency ? amount : rate?.rate ? convertMoney(amount, rate.rate) : amount;
    const appuserCurrencyKey = appuser.currencyKey;
    const transactionMerchantKey = await this.resolveMerchant(em, tx);
    const metadata = this.buildTransactionMetadata(row, metadataEnrichmentEnabled);
    const common: EntityData<Transaction> = { accountKey: account, appuserCurrencyExchangeRate: rate?.rate, appuserCurrencyKey, appuserSettlementAmount, ...metadata, enableBankingTransactionId, externalTransactionId, internalTransactionId, nordigenInternalTransactionId, originalAmount: Number.isFinite(originalAmount) ? originalAmount : amount, originalCurrencyKey: originalCurrencyKey ?? currency, settlementAmount: amount, settlementCurrencyKey: currency, settlementExchangeRate, tenantKey: tenant.tenantKey, transactionDate: date, transactionMerchantKey, transactionStatusKey: status, transactionTypeKey: type };
    if (existing && existingMatch) {
      // A pending row has no running balance. A legacy row stored as booked, and still pending at
      // the provider, would otherwise keep the stale balance it was given, and net-worth history
      // reads the latest non-null balance whatever the status.
      if (pending) Object.assign(existing as unknown as Record<string, unknown>, NO_RUNNING_BALANCE);
      // Emit a DEDUP_SKIPPED audit row so we can measure the false-positive-skip
      // rate (matchedOn=internalTransactionId with a *different* bank id on the existing row).
      // Best-effort: the audit service never throws, and the write is inside the same em.
      await TransactionAuditService.log(em, {
        accountKey: account.accountKey,
        actorType: TransactionAuditActorType.SYNC,
        appuserKey: getAppuserKey(tenant.appuserKey),
        changes: {
          ...(existingMatch.matchedOn === LEGACY_MATCH ? { incomingEnableBankingTransactionId: { from: existing.enableBankingTransactionId ?? null, to: enableBankingTransactionId } } : {}),
          incomingExternalTransactionId: { from: null, to: externalTransactionId },
          incomingInternalTransactionId: { from: null, to: generatedInternalTransactionId },
          incomingNordigenInternalTransactionId: { from: null, to: nordigenInternalTransactionId },
          matchedOn: { from: null, to: existingMatch.matchedOn },
        },
        eventType: TransactionAuditEventType.DEDUP_SKIPPED,
        source: 'account-initial-sync',
        tenantKey: tenant.tenantKey.tenantKey,
        transactionKey: existing.transactionKey,
      });
      // A user's amount edit outlives re-syncs. The bank's amount still refreshes `originalAmount`,
      // but the columns the balance chain and aggregates read keep the edit (converted at this sync's rate).
      const edited = existing.editedSettlementAmount;
      if (edited != null) {
        const editedAmount = toNumber(edited);
        common.settlementAmount = editedAmount;
        // The bank's current amount stays the bound for the user's next edit.
        common.uneditedSettlementAmount = amount;
        common.appuserSettlementAmount = sameCurrency ? editedAmount : rate?.rate ? convertMoney(editedAmount, rate.rate) : editedAmount;
      }
      // The type is written when a row is created, and afterwards only by transfer matching
      // (which pairs and un-pairs rows, and re-types a legacy TRANSFER_IN credit). Re-fetching a row
      // must not undo a pair, or a type a user set.
      delete common.transactionTypeKey;
      Object.assign(existing as unknown as Record<string, unknown>, common); try { await em.persist(existing).flush(); return { created: 0, failed: 0, skipped: 0, tenantKey: existing.tenantKey?.tenantKey }; } catch (error) { return isDuplicate(error) ? { created: 0, failed: 0, skipped: 1 } : { created: 0, failed: 1, skipped: 0 }; }
    }
    const transactionEntity = em.create(Transaction, { ...common, appuserKey: tenant.appuserKey }, { partial: true });
    try { await em.persist(transactionEntity).flush(); const categorized = transactionMerchantKey ? await this.categorizeIfEnabled(em, tenant.appuserKey, transactionEntity) : 0; return { categorized, created: 1, failed: 0, skipped: 0, tenantKey: transactionEntity.tenantKey?.tenantKey }; } catch (error) { if (isDuplicate(error)) return { categorized: 0, created: 0, failed: 0, skipped: 1 }; return { categorized: 0, created: 0, failed: 1, skipped: 0 }; }
  }
  /**
   * Retract stored copies of rows the provider now reports as rejected or cancelled. A legacy row
   * may have been ingested as booked (every Enable Banking status but `PEND` once was), so it may
   * sit in the running balance and the totals. It is found by the id the sync stored it under (hidden and
   * soft-deleted rows included, as both are chain members), moved to EXPIRED with no running balance,
   * and audited. EXPIRED, not deleted: it never settled, and the row and its user edits stay
   * inspectable. The chain rebuild after the persist loop drops it from the balances. Best-effort.
   */
  private async applyVoids(em: EntityManager, account: Account, voided: BankSyncTransaction[], expiredStatus: TransactionStatus, enableBanking: boolean): Promise<void> {
    if (!enableBanking || voided.length === 0) return;
    const accountId = account.accountId ?? String(account.accountKey);
    for (const row of voided) {
      try {
        const currencyCode = row.transactionAmount?.currency ?? row.currency;
        const currency = currencyCode ? await em.findOne(Currency, { code: currencyCode }) : null;
        if (!currency) continue;
        const match = await findEnableBankingTransaction(accountId, row, currency, (id) => em.findOne(Transaction, { accountKey: account, enableBankingTransactionId: id }, { filters: { [HIDDEN_FILTER]: false }, populate: ['transactionStatusKey'] }));
        const stored = match?.existing;
        if (!stored) continue;
        const from = stored.transactionStatusKey?.name;
        if (from === expiredStatus.name) continue;
        const balanceBefore = stored.balance ?? null;
        Object.assign(stored as unknown as Record<string, unknown>, NO_RUNNING_BALANCE, { transactionStatusKey: expiredStatus });
        await em.persist(stored).flush();
        await TransactionAuditService.log(em, { accountKey: account.accountKey, actorType: TransactionAuditActorType.SYNC, appuserKey: getAppuserKey(stored.appuserKey), changes: { balance: { from: balanceBefore, to: null }, reason: { from: null, to: `provider_status:${row.providerStatus ?? 'unknown'}` }, transactionStatusKey: { from: from ?? null, to: expiredStatus.name } }, eventType: TransactionAuditEventType.SYSTEM_EDIT, source: 'enable-banking-voided', tenantKey: stored.tenantKey?.tenantKey ?? 0, transactionKey: stored.transactionKey });
      } catch (error) { logger.warn({ error: sanitizeError(error) }, 'Retracting a voided transaction failed'); }
    }
  }

  /**
   * Promote matched pending rows in place. For each booked row that
   * uniquely matches a stored pending (exact amount/currency/counterparty, ±5d), set that pending's
   * provider id to the booked row's, so the subsequent persist loop finds it and updates it in place
   * (status→BOOKED, balance, date, amount) — preserving the user's category/notes and never creating
   * a duplicate. Returns the keys of the pendings it promoted or expired (so expiry skips them).
   *
   * The booked row may already be stored (the provider id is unique per account). Then the
   * pending is not promoted: re-keying it would collide, or, for a row the sync would find through
   * its legacy id, leave two booked copies. A pending that has left the pending feed is the ghost of
   * that booked row and is expired; one still in the feed is a separate transaction and is left alone.
   * Each promotion writes on its own and a failed write is undone in memory, so one failure never
   * stops the other promotions or leaves a change in the unit of work for every later flush to retry.
   */
  private async applyPromotions(em: EntityManager, account: Account, tenant: AppuserTenant, booked: BankSyncTransaction[], statuses: { expired: null | TransactionStatus; pending: TransactionStatus }, seenPendingIdentities: Set<string>, enableBanking = false): Promise<Set<number>> {
    const handled = new Set<number>();
    const accountId = account.accountId ?? String(account.accountKey);
    let plan: ReturnType<typeof planPromotions>; let pendingByKey: Map<number, Transaction>;
    try {
      // Hidden pendings too: otherwise the booked row is stored again as a visible duplicate.
      const storedPendings = await em.find(Transaction, { accountKey: account, deletedAt: undefined, transactionStatusKey: statuses.pending }, { filters: { [HIDDEN_FILTER]: false }, populate: ['settlementCurrencyKey'] });
      if (storedPendings.length === 0) return handled;
      const bookedMatchables = booked.map((row) => { const tx = row as Partial<BankSyncTransaction>; return { counterparty: tx.creditorName ?? tx.debtorName ?? undefined, currencyCode: tx.transactionAmount?.currency ?? tx.currency ?? '', settlementAmount: Number(tx.transactionAmount?.amount ?? tx.amount), transactionDate: rowDate(tx) }; });
      const pendingMatchables = storedPendings.map((pending) => ({ currencyCode: pending.settlementCurrencyKey?.code ?? '', settlementAmount: pending.settlementAmount ?? 0, transactionDate: pending.transactionDate ?? new Date(0), transactionKey: pending.transactionKey }));
      plan = planPromotions(bookedMatchables, pendingMatchables);
      pendingByKey = new Map(storedPendings.map((pending) => [pending.transactionKey, pending]));
    } catch (error) { logger.warn({ error: sanitizeError(error) }, 'Pending promotion failed'); return handled; }
    for (const { bookedIndex, pendingKey } of plan) {
      const pending = pendingByKey.get(pendingKey); const row = booked[bookedIndex];
      if (!pending || !row) continue;
      const tx = row as Partial<BankSyncTransaction>;
      try {
        const alreadyStored = await this.findStoredBookedRow(em, account, row, enableBanking);
        if (alreadyStored && alreadyStored.transactionKey !== pendingKey) {
          if (!statuses.expired || isStillPending(pending, seenPendingIdentities)) continue;
          await writeIsolated(em, pending, { transactionStatusKey: statuses.expired });
          handled.add(pendingKey);
          await TransactionAuditService.log(em, { accountKey: account.accountKey, actorType: TransactionAuditActorType.SYNC, appuserKey: getAppuserKey(pending.appuserKey), changes: { reason: { from: null, to: 'booked_row_already_stored' }, transactionStatusKey: { from: 'PENDING', to: 'EXPIRED' } }, eventType: TransactionAuditEventType.PENDING_EXPIRED, source: 'pending-reconciliation', tenantKey: pending.tenantKey?.tenantKey ?? 0, transactionKey: pendingKey });
          continue;
        }
        // Promote into the provider-matching column only — see `persistTransaction`'s
        // identical column split.
        await writeIsolated(em, pending, enableBanking
          ? { enableBankingTransactionId: enableBankingTransactionIdFor(accountId, row) }
          : { nordigenInternalTransactionId: tx.internalTransactionId ?? tx.transactionId ?? tx.entryReference ?? this.buildStableId(accountId, row, 'nordigen') });
        handled.add(pendingKey);
        await TransactionAuditService.log(em, { accountKey: account.accountKey, actorType: TransactionAuditActorType.SYNC, appuserKey: getAppuserKey(tenant.appuserKey), changes: { transactionStatusKey: { from: 'PENDING', to: 'BOOKED' } }, eventType: TransactionAuditEventType.PENDING_PROMOTED, source: 'pending-reconciliation', tenantKey: pending.tenantKey?.tenantKey ?? 0, transactionKey: pendingKey });
      } catch (error) { logger.warn({ error: sanitizeError(error), transactionKey: pendingKey }, 'Pending promotion failed'); }
    }
    return handled;
  }

  /**
   * The stored row a booked feed row is, if the sync already holds it — looked up the way the
   * persist loop would find it, hidden rows included, since the unique provider id covers them too.
   */
  private async findStoredBookedRow(em: EntityManager, account: Account, row: BankSyncTransaction, enableBanking: boolean): Promise<null | Transaction> {
    const tx = row as Partial<BankSyncTransaction>;
    const accountId = account.accountId ?? String(account.accountKey);
    const options = { filters: { [HIDDEN_FILTER]: false } };
    if (!enableBanking) return em.findOne(Transaction, { accountKey: account, nordigenInternalTransactionId: tx.internalTransactionId ?? tx.transactionId ?? tx.entryReference ?? this.buildStableId(accountId, row, 'nordigen') }, options);
    const lookup = (id: string) => em.findOne(Transaction, { accountKey: account, enableBankingTransactionId: id }, options);
    const currencyCode = tx.transactionAmount?.currency ?? tx.currency;
    const currency = currencyCode ? await em.findOne(Currency, { code: currencyCode }) : null;
    if (!currency) return lookup(enableBankingTransactionIdFor(accountId, row));
    return (await findEnableBankingTransaction(accountId, row, currency, lookup))?.existing ?? null;
  }

  /**
   * Expire ghost pendings — stored PENDING rows that dropped out of the feed
   * and are past the grace window move to EXPIRED (hidden, auditable). Skips rows just promoted this
   * sync. Pending rows carry no running balance, so this is a status change only. Best-effort.
   */
  private async applyExpirations(em: EntityManager, account: Account, pendingStatus: TransactionStatus, expiredStatus: TransactionStatus, seenIdentities: Set<string>, promotedKeys: Set<number>): Promise<void> {
    try {
      // Hidden pendings too: a ghost the user hid is still a ghost.
      const storedPendings = await em.find(Transaction, { accountKey: account, deletedAt: undefined, transactionStatusKey: pendingStatus }, { filters: { [HIDDEN_FILTER]: false } });
      if (storedPendings.length === 0) return;
      const expirable = storedPendings
        .filter((pending) => !promotedKeys.has(pending.transactionKey))
        // `planPendingExpirations` ignores null/undefined entries, so each row contributes only the
        // identity columns its provider fills.
        .map((pending) => ({ identities: [pending.nordigenInternalTransactionId, pending.externalTransactionId, pending.enableBankingTransactionId], transactionDate: pending.transactionDate ?? new Date(0), transactionKey: pending.transactionKey }));
      const keys = planPendingExpirations(expirable, seenIdentities, { graceDays: DEFAULT_PENDING_GRACE_DAYS, now: new Date() });
      const pendingByKey = new Map(storedPendings.map((pending) => [pending.transactionKey, pending]));
      for (const key of keys) {
        const pending = pendingByKey.get(key);
        if (!pending) continue;
        pending.transactionStatusKey = expiredStatus;
        await em.persist(pending).flush();
        await TransactionAuditService.log(em, { accountKey: account.accountKey, actorType: TransactionAuditActorType.SYNC, appuserKey: pending.appuserKey?.appuserKey ?? 0, changes: { transactionStatusKey: { from: 'PENDING', to: 'EXPIRED' } }, eventType: TransactionAuditEventType.PENDING_EXPIRED, source: 'pending-expiry', tenantKey: pending.tenantKey?.tenantKey ?? 0, transactionKey: key });
      }
    } catch (error) { logger.warn({ error: sanitizeError(error) }, 'Pending expiry failed'); }
  }

  private async resolveMerchant(em: EntityManager, row: Partial<BankSyncTransaction>) { const merchantName = sanitizeMerchantName(row.creditorName ?? row.debtorName ?? row.remittanceInformationStructured ?? row.remittanceInformationUnstructured ?? row.entryReference); if (!merchantName) return undefined; const existing = await em.findOne(TransactionMerchant, { name: merchantName }); if (existing) return existing; const merchant = em.create(TransactionMerchant, { name: merchantName }, { partial: true }); try { await em.persist(merchant).flush(); return merchant; } catch (error) { if (!isDuplicate(error)) throw error; const reloaded = await em.findOne(TransactionMerchant, { name: merchantName }); if (reloaded) return reloaded; throw error; } }
  /**
   * Income unless matched. A credit is a DEPOSIT (income); transfer matching re-types it
   * TRANSFER_IN only when it pairs with the same amount leaving another account of the household.
   * A credit typed TRANSFER_IN would be left out of reports, so synced income would not count.
   * The type is no input to a row's identity (`buildStableId`, the generated internal id).
   */
  private resolveType(row: BankSyncTransaction, types: Map<string, TransactionType>) { const credit = (row.creditDebitIndicator ?? '').toLowerCase() === 'credit'; return credit ? types.get('DEPOSIT') ?? null : types.get('PAYMENT') ?? types.get('CARD_PAYMENT') ?? null; }
}

/**
 * The identity a synced row is stored under: the provider's id when it sent one, otherwise a hash
 * of its fields. Enable Banking rows hash `stableIdFields` (the unsigned provider amount and the
 * legacy indicator mapping), so signing the amount does not re-key stored rows. Neither the provider
 * status nor `transactionDate` is an input, so re-classifying a row never changes its identity.
 * Exported for the status repair, which must find stored rows exactly as the sync does.
 */
export function buildStableId(accountId: string, row: BankSyncTransaction, prefix: 'enable_banking' | 'nordigen' = 'nordigen') { const transaction = row as Partial<BankSyncTransaction>; const preferred = transaction.transactionId ?? transaction.internalTransactionId ?? transaction.entryReference; if (preferred) return `${prefix}:${preferred}`; const hash = crypto.createHash('sha256').update(JSON.stringify({ accountId, amount: transaction.stableIdFields?.amount ?? transaction.transactionAmount?.amount ?? transaction.amount ?? null, bookingDate: transaction.bookingDate ?? null, creditorName: transaction.creditorName ?? null, creditorReference: transaction.creditorReference ?? null, currency: transaction.transactionAmount?.currency ?? transaction.currency ?? null, debit: (transaction.stableIdFields ? transaction.stableIdFields.creditDebitIndicator : transaction.creditDebitIndicator) ?? null, debtorName: transaction.debtorName ?? null, remittance: transaction.remittanceInformationUnstructured ?? null, remittanceStructured: transaction.remittanceInformationStructured ?? null, valueDate: transaction.valueDate ?? null })).digest('hex'); return `${prefix}:${hash}`; }

/**
 * The `enableBankingTransactionId` the sync stores for a row: its `entry_reference`, otherwise what
 * the legacy id (`legacyEnableBankingTransactionIdFor`).
 *
 * Enable Banking documents `transaction_id` as "Identification used for fetching transaction
 * details. This value can not be used to uniquely identify transactions and may change if the list
 * of transactions is retrieved again", and `entry_reference` as "Unique transaction identifier
 * provided by ASPSP. This identifier is both unique and immutable for accounts with the same
 * identification hashes and can be used for matching transactions across multiple PSU authentication
 * sessions" (https://enablebanking.com/docs/api/reference/#transaction). It is not globally unique,
 * which the `(account_key, enable_banking_transaction_id)` unique constraint already allows for.
 */
export function enableBankingTransactionIdFor(accountId: string, row: BankSyncTransaction): string { return nonEmpty(row.entryReference) ?? legacyEnableBankingTransactionIdFor(accountId, row); }

/** The legacy id a row may be stored under: `transaction_id`, then `entry_reference`, then the stable hash. */
export function legacyEnableBankingTransactionIdFor(accountId: string, row: BankSyncTransaction): string { return row.transactionId ?? row.entryReference ?? buildStableId(accountId, row, 'enable_banking'); }

const LEGACY_MATCH = 'legacyEnableBankingTransactionId';
/** How far a row's date may move between fetches (a pending row booked later): the pending↔booked window. */
const LEGACY_MATCH_WINDOW_DAYS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The stored Enable Banking row `row` describes. It is looked up by `enableBankingTransactionIdFor`
 * first. A legacy row sits under its `transaction_id` instead; it is looked up by that and
 * accepted only if it is the same transaction, because the provider may have handed the same
 * `transaction_id` to another transaction since. The caller writes the new id onto it, which re-keys it
 * in place: every row still in the fetch window migrates on its next sync, and nothing is created twice.
 */
async function findEnableBankingTransaction(accountId: string, row: BankSyncTransaction, currency: Currency, lookup: (id: string) => Promise<null | Transaction>): Promise<null | { existing: Transaction; matchedOn: 'enableBankingTransactionId' | typeof LEGACY_MATCH }> {
  const id = enableBankingTransactionIdFor(accountId, row);
  const current = await lookup(id);
  if (current) return { existing: current, matchedOn: 'enableBankingTransactionId' };
  const legacyId = legacyEnableBankingTransactionIdFor(accountId, row);
  if (legacyId === id) return null;
  const legacy = await lookup(legacyId);
  return legacy && isSameEnableBankingTransaction(legacy, row, currency) ? { existing: legacy, matchedOn: LEGACY_MATCH } : null;
}

/**
 * Whether a stored row is the transaction a provider row describes: same settlement currency, a date
 * within the pending↔booked window, and the same amount. Amounts are compared without sign (legacy
 * rows hold unsigned debits) and against both the bank's figures the row keeps
 * (`originalAmount` is never user-edited; `settlementAmount` is, so either may be the one that matches).
 */
function isSameEnableBankingTransaction(stored: Transaction, row: BankSyncTransaction, currency: Currency): boolean {
  if (stored.settlementCurrencyKey?.currencyKey !== currency.currencyKey) return false;
  const date = rowDate(row);
  if (!stored.transactionDate || Number.isNaN(date.getTime()) || Math.abs(new Date(stored.transactionDate).getTime() - date.getTime()) > LEGACY_MATCH_WINDOW_DAYS * MS_PER_DAY) return false;
  const amount = Number(row.transactionAmount?.amount ?? row.amount);
  const rate = row.currencyExchange?.exchangeRate != null ? Number(row.currencyExchange.exchangeRate) : undefined;
  const incoming = [amount, Number(row.currencyExchange?.instructedAmount?.amount), rate ? amount * rate : Number.NaN].filter(Number.isFinite).map((value) => Math.abs(roundMoney(value, 2)));
  const kept = [stored.originalAmount, stored.settlementAmount].filter((value) => value != null).map((value) => Math.abs(roundMoney(toNumber(value), 2)));
  return kept.some((value) => incoming.includes(value));
}

/** A synced row's date. `transactionDate` is only a fallback, for a pending row with no booking or value date yet. */
function dateOffset(date: Date, days: number) { const copy = new Date(date); copy.setDate(copy.getDate() - days); return isoDate(copy); }

function getAppuserKey(appuserKey?: unknown): number { if (typeof appuserKey === 'number') return appuserKey; if (appuserKey && typeof appuserKey === 'object' && typeof (appuserKey as { appuserKey?: unknown }).appuserKey === 'number') return (appuserKey as { appuserKey: number }).appuserKey; return 0; }
function isDuplicate(error: unknown) { if (error instanceof UniqueConstraintViolationException) return true; if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' && DUPLICATE_ERROR_CODES.has((error as { code: string }).code)) return true; if (error instanceof Error && /unique|duplicate/i.test(error.message)) return true; return false; }
/** Whether a stored pending is still in this fetch's pending feed, under any identity it is stored with. */
function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function isStillPending(pending: Transaction, seenIdentities: Set<string>): boolean { return [pending.nordigenInternalTransactionId, pending.externalTransactionId, pending.enableBankingTransactionId].some((id) => id != null && seenIdentities.has(id)); }
function nonEmpty(value?: null | string) { return value?.trim() ? value : undefined; }
function rowDate(row: Partial<BankSyncTransaction>): Date { return new Date(row.bookingDate ?? row.valueDate ?? row.transactionDate ?? ''); }
function sanitizeDirty(value?: string): string | undefined { if (!value) return undefined; return value.normalize('NFKC').split('').map((char) => { const code = char.charCodeAt(0); return code <= 31 || code === 127 ? ' ' : char; }).join('').replace(/\s+/g, ' ').trim().slice(0, 255) || undefined; }
function sanitizeError(error: unknown) { if (!error || typeof error !== 'object') return { message: String(error) }; const safe = error as { code?: unknown; message?: unknown; name?: unknown; status?: unknown }; return { code: typeof safe.code === 'string' ? safe.code : undefined, message: typeof safe.message === 'string' ? safe.message : undefined, name: typeof safe.name === 'string' ? safe.name : undefined, providerResponse: sanitizeProviderResponse(error), status: typeof safe.status === 'number' || typeof safe.status === 'string' ? safe.status : undefined }; }
function sanitizeMerchantName(value?: string) { return value ? value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 255) || undefined : undefined; }

/**
 * Write `changes` onto `entity` and flush. If the flush fails the changes are undone in memory:
 * a failed flush leaves the entity dirty, and the next flush on this entity manager would retry the
 * same write (and fail the same way) on behalf of whatever unrelated row it was meant to save.
 */
async function writeIsolated<T extends object>(em: EntityManager, entity: T, changes: Partial<T>): Promise<void> {
  const before = Object.fromEntries(Object.keys(changes).map((key) => [key, entity[key as keyof T]])) as Partial<T>;
  Object.assign(entity, changes);
  try { await em.persist(entity).flush(); } catch (error) { Object.assign(entity, before); throw error; }
}

export default new AccountInitialSyncTransactionService();
