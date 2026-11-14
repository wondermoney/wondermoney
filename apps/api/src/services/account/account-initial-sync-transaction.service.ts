import crypto from 'node:crypto';

import { type EntityData, type EntityManager, type FilterQuery, UniqueConstraintViolationException } from '@mikro-orm/core';
import * as Sentry from '@sentry/node';
import { generateInternalTransactionId } from '@wondermoney/shared';

import { DI } from '@app/database/di';
import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { BankConnectionStatus } from '@entity/BankConnection';
import { Currency } from '@entity/Currency';
import { FxStatus, Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionStatus } from '@entity/TransactionStatus';
import { TransactionType } from '@entity/TransactionType';
import type { BankReportedErrorCode } from '@service/bank-providers/errors';
import type {
  BankConnectionRef,
  BankProvider,
  BankProviderTransaction,
  BankStableIdFields,
  BankTransactionIdentity,
} from '@service/bank-providers/types';
import { isProviderRejection, type ProviderRateLimit, providerRateLimitOf, providerReportedCodeOf } from '@service/bank-sync-run/provider-failure';
import { rateScope, resolveExchangeRate } from '@service/currency/exchange-rate';
import { linkPostedInstallments } from '@service/installment/installment-plan.service';
import backgroundOperationService from '@service/operations/background-operation.service';
import type { Enqueue } from '@service/queue/enqueue';
import { triggerRecurringDetectionAfterTransactionIngestion } from '@service/recurring/post-transaction-ingestion-detection.service';
import { applyRulesToNewTransactions } from '@service/rules/rule-application.service';
import { enqueueTransactionEnrichmentForTenant } from '@service/transaction-enrichment/transaction-enrichment-enqueue.service';
import { recalculateChainFromAccountBalance } from '@service/transaction/balance-chain.service';
import { applyBayesCategorization, prepareBayesCategorization } from '@service/transaction/bayes-categorization.service';
import { applyCategorizationOutcome } from '@service/transaction/categorization-confidence';
import { DEFAULT_PENDING_GRACE_DAYS, logDryRunExpirations, planPendingExpirations } from '@service/transaction/pending-expiry.service';
import { getReconciliationMode, logDryRunPromotions, planPromotions } from '@service/transaction/pending-reconciliation.service';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { findExistingTransaction, findExistingTransactionWithProvenance } from '@service/transaction/transaction-dedup.service';
import deterministicCategorizationService from '@service/transaction/transaction-deterministic-categorization.service';
import { enrichTransactionMetadata, isTransactionMetadataEnrichmentEnabled } from '@service/transaction/transaction-metadata-enrichment.service';
import { reconcileSplitsWithAmount } from '@service/transaction/transaction-split.service';
import { reconcileTransfers } from '@service/transaction/transfer-matching.service';
import { sanitizeProviderResponse } from '@utils/error-sanitizer';
import { InternalServerError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';
import { convertMoney, roundMoney, toNumber } from '@utils/money';

/** See the identical note in `account-initial-sync-account.service.ts` — `requisitionId`/
 * `requisitionKey` are provider-agnostic sync-target identity fields. */
export interface AccountInitialSyncTransactionsResult { accountsFailed: number; accountsProcessed: number; accountsTotal: number; appuserKey: number; everyAccountRejected?: boolean; failedAccountIds: string[]; rateLimited?: ProviderRateLimit; /** What the aggregator reported for an account that failed. */ reportedErrorCode?: BankReportedErrorCode; requisitionId: string; requisitionKey: number; status: 'completed' | 'failed' | 'partial'; transactionsCategorized: number; transactionsCreated: number; transactionsFailed: number; transactionsFetched: number; transactionsSkipped: number; }

/** One provider transaction row, re-exported under the name the sync services and tests use. */
export type BankSyncTransaction = BankProviderTransaction;
export type StableIdFields = BankStableIdFields;
interface Deps { backgroundOperationService?: typeof backgroundOperationService; em?: EntityManager; enqueue?: Enqueue; logger?: Pick<typeof logger, 'error' | 'info' | 'warn'>; /** The aggregator to sync through; tests inject a fake, production gets it from the registry. */ provider?: BankProvider; }

/** The provider seam — see the identical-purpose `SyncTarget` in
 * `account-initial-sync-account.service.ts` for the full rationale. */
interface SyncTarget { appuserRef: number; client: BankProvider; connection: BankConnectionRef; requisitionId: string; requisitionKey: number; transactionIdentity: BankTransactionIdentity; }

const DUPLICATE_ERROR_CODES = new Set(['23505']);
/** What a row outside the running-balance chain carries (PENDING, EXPIRED). */
const NO_RUNNING_BALANCE = { appuserCurrencyBalance: null, balance: null } as const;
/** Sync reads see the rows a user hid: hiding a transaction changes where it shows, not what it is. */
const INCLUDE_HIDDEN = { includeHidden: true } as const;

class AccountInitialSyncTransactionService {
  async syncTransactionsForRequisition(
    input: { connection: BankConnectionRef; correlationId?: string; fetchWindowDays?: number; queueJobId?: string },
    deps: Deps = {},
  ): Promise<AccountInitialSyncTransactionsResult> {
    const em = deps.em ?? DI.em;
    const log = deps.logger ?? logger;
    const bg = deps.backgroundOperationService ?? backgroundOperationService;
    const metadataEnrichmentEnabled = isTransactionMetadataEnrichmentEnabled();

    const target = this.resolveSyncTarget(input, deps);
    const { appuserRef, client, connection, requisitionId, requisitionKey, transactionIdentity } = target;
    const enableBanking = transactionIdentity.column === 'enableBankingTransactionId';

    const tenant = await em.findOne(AppuserTenant, { appuserKey: appuserRef as unknown as AppuserTenant['appuserKey'], deletedAt: undefined, recordActive: true }, { populate: ['appuserKey.currencyKey'] });
    if (!tenant) throw new NotFoundError('Active tenant not found for requisition');

    // `bankConnectionKey` is the provider-agnostic pointer; the legacy Enable Banking column is
    // the fallback for a row the start-up backfill has not reached yet (and for old fixtures).
    const accounts = await em.find(Account, {
      $or: [
        { bankConnectionKey: connection.bankConnectionKey },
        { enableBankingConnectionKey: connection.bankConnectionKey },
      ],
      deletedAt: undefined,
    } as FilterQuery<Account>);
    if (accounts.length === 0) return this.emptyResult(requisitionId, requisitionKey, appuserRef);

    const txnStatusBooked = await this.findTransactionStatus(em, ['BOOKED']);
    const txnStatusPending = await this.findTransactionStatus(em, ['PENDING']);
    const txnStatusExpired = await this.findTransactionStatus(em, ['EXPIRED']);
    const reconciliationMode = getReconciliationMode();
    const transactionTypes = await this.loadTransactionTypes(em);
    const settledStatusByName = { BOOKED: txnStatusBooked, PENDING: txnStatusPending };

    // Train the viewer's local model once for this sync; every row the sync creates reuses it.
    // Best-effort: a training failure leaves the batch null and the sync untouched.
    const bayesBatch = await prepareBayesCategorization(em, { tenantKey: tenant.tenantKey.tenantKey, viewerAppuserKey: tenant.appuserKey.appuserKey }).catch((error: unknown) => {
      log.warn({ error: sanitizeError(error) }, 'Bayes categorization training failed');
      return null;
    });

    let transactionsCreated = 0; let transactionsCategorized = 0; let transactionsFetched = 0; let transactionsFailed = 0; let transactionsSkipped = 0;
    const failedAccountIds: string[] = []; const processedAccountIds = new Set<string>(); const affectedTenantKeys = new Set<number>();
    const createdTransactions: Transaction[] = [];
    // See `account-initial-sync-account.service.ts`: a rate limit stops the loop, and a 400/401 on
    // every account is reported so the worker can check whether the consent ended.
    let rateLimited: ProviderRateLimit | undefined; let rejectedCount = 0; let reportedErrorCode: BankReportedErrorCode | undefined;
    for (const [index, account] of accounts.entries()) {
      let accountCreated = 0; let accountFailed = 0; let accountSkipped = 0;
      try {
        const response = await client.getTransactions(connection, account.accountId ?? '', { country: '', dateFrom: dateOffset(new Date(), input.fetchWindowDays ?? 365), dateTo: isoDate(new Date()) });
        const transactions = response;
        const accountStableId = account.accountId ?? String(account.accountKey);
        // Identical id-less rows are told apart by their position among their twins, counted per
        // list: a pending row and its booked version must not shift each other's identity.
        const booked = withStableIdOccurrences(accountStableId, transactions.booked ?? []);
        const pending = withStableIdOccurrences(accountStableId, transactions.pending ?? []);
        const voided = withStableIdOccurrences(accountStableId, transactions.voided ?? []);
        // A rejected or cancelled row is never ingested, and a stored copy (e.g. a legacy row stored
        // as booked) is retracted. Before promotions, so a voided pending can
        // never be promoted by an unrelated booked row of the same amount.
        if (txnStatusExpired) await this.applyVoids(em, account, voided, txnStatusExpired, enableBanking);
        // Pending→posted reconciliation. `apply` promotes/expires in place (live);
        // `dry_run` only logs intended changes. Off = kill switch. Always before the persist loop so a
        // promoted pending is then found by provider-id dedup and updated (never duplicated).
        if (reconciliationMode !== 'off' && txnStatusPending) {
          const seenPendingIdentities = new Set<string>();
          // An id-less Enable Banking pending is stored under its stable hash, so that hash is one
          // of its identities too; without it a pending still in the feed would expire after the grace window.
          for (const row of pending) { const tx = row as Partial<BankSyncTransaction>; for (const id of [tx.transactionId, tx.internalTransactionId, tx.entryReference, enableBanking ? this.buildStableId(accountStableId, row, transactionIdentity.prefix) : undefined]) if (id) seenPendingIdentities.add(id); }
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
        const accountTransactionsStart = createdTransactions.length;
        for (const item of rows) {
          const mapped = await this.persistTransaction(em, account, tenant, item.row, item.pending, settledStatusByName, transactionTypes, metadataEnrichmentEnabled, enableBanking);
          accountCreated += mapped.created; accountSkipped += mapped.skipped; accountFailed += mapped.failed; if (mapped.createdTransaction) createdTransactions.push(mapped.createdTransaction); if (mapped.created > 0 && mapped.tenantKey) affectedTenantKeys.add(mapped.tenantKey);
        }
        transactionsCategorized += await this.categorizeNewTransactions(em, tenant, createdTransactions.slice(accountTransactionsStart));
        await this.auditMissingOccurrences(em, account, tenant, booked, enableBanking);
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
        if (isProviderRejection(error)) rejectedCount += 1;
        reportedErrorCode ??= providerReportedCodeOf(error);
        rateLimited = providerRateLimitOf(error);
        if (rateLimited) {
          // The accounts not yet fetched count as failed, so their freshness marker stays put.
          failedAccountIds.push(...accounts.slice(index + 1).map((rest) => rest.accountId ?? String(rest.accountKey)));
          log.warn({ accountId: account.accountId, rateLimited }, 'Account initial sync stopped: provider rate limit');
          break;
        }
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
      // Link posted rows that pay an installment of a card's plan ("PARC 03/12"), so the plan reads
      // them as paid instead of projecting them again. A pending charge is not linked; once the bank
      // posts it, the promotion above flips the row in place and this pass, over every unlinked
      // charge, links it. Best-effort, like transfer matching.
      try {
        const linked = await em.fork().transactional((tx) => linkPostedInstallments(tx, { tenantKey: tenant.tenantKey.tenantKey }));
        if (linked > 0) log.info({ linked, tenantKey: tenant.tenantKey.tenantKey }, 'Linked posted installments');
      } catch (error) {
        log.warn({ error: sanitizeError(error) }, 'Installment linking failed');
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

    // The local, token-free pass runs after the deterministic categorizer and before any AI
    // enqueue, so a row it labels never reaches a model. Best-effort; it never fails the sync.
    if (bayesBatch && createdTransactions.length > 0) {
      try {
        const assigned = await applyBayesCategorization(em, bayesBatch, createdTransactions);
        if (assigned > 0) log.info({ assigned, tenantKey: tenant.tenantKey.tenantKey }, 'Bayes categorized transactions');
      } catch (error) {
        log.warn({ error: sanitizeError(error) }, 'Bayes categorization failed');
      }
    }
    for (const tenantKey of affectedTenantKeys) await triggerRecurringDetectionAfterTransactionIngestion(tenantKey, 'account-initial-sync');
    // Best-effort, fail-open shadow enrichment enqueue. Dormant by default; never blocks sync.
    for (const tenantKey of affectedTenantKeys) await enqueueTransactionEnrichmentForTenant(tenantKey, 'account-initial-sync', { enqueue: deps.enqueue });
    const status = failedAccountIds.length === accounts.length ? 'failed' : failedAccountIds.length > 0 ? 'partial' : 'completed';
    const signals = { ...(processedAccountIds.size === 0 && rejectedCount === accounts.length ? { everyAccountRejected: true } : {}), ...(rateLimited ? { rateLimited } : {}), ...(reportedErrorCode ? { reportedErrorCode } : {}) };
    return { accountsFailed: failedAccountIds.length, accountsProcessed: processedAccountIds.size, accountsTotal: accounts.length, appuserKey: getAppuserKey(appuserRef), ...signals, failedAccountIds, requisitionId, requisitionKey, status, transactionsCategorized, transactionsCreated, transactionsFailed, transactionsFetched, transactionsSkipped };
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
  /**
   * The rows this sync created on one account, in order: the household's rules first (once for the
   * batch), then learned categorization, which leaves a row a rule categorized as it is. Only
   * created rows: a re-fetched row is never run through the rules again, so nothing the user changed
   * since is undone. Both steps are best-effort and never fail the sync. Returns how many rows got a
   * category.
   */
  private async categorizeNewTransactions(em: EntityManager, tenant: AppuserTenant, created: Transaction[]): Promise<number> {
    if (created.length === 0) return 0;
    const applied = await applyRulesToNewTransactions(em, tenant.tenantKey.tenantKey, created.map((transaction) => transaction.transactionKey), 'account-initial-sync');
    let categorized = applied.filter((evaluation) => evaluation.changes.category).length;
    for (const transaction of created) {
      if (transaction.transactionMerchantKey) categorized += await this.categorizeIfEnabled(em, tenant.appuserKey, transaction);
    }
    return categorized;
  }
  private emptyResult(requisitionId: string, requisitionKey: number, appuserRef: number): AccountInitialSyncTransactionsResult { return { accountsFailed: 0, accountsProcessed: 0, accountsTotal: 0, appuserKey: getAppuserKey(appuserRef), failedAccountIds: [], requisitionId, requisitionKey, status: 'failed', transactionsCategorized: 0, transactionsCreated: 0, transactionsFailed: 0, transactionsFetched: 0, transactionsSkipped: 0 }; }
  private async findTransactionStatus(em: EntityManager, names: string[]) { for (const name of names) { const status = await em.findOne(TransactionStatus, { name }); if (status) return status; } return null; }
  private async loadTransactionTypes(em: EntityManager) { const names = ['TRANSFER_IN', 'TRANSFER_OUT', 'PAYMENT', 'CARD_PAYMENT', 'DEPOSIT', 'TOPUP', 'FEE']; const out = new Map<string, TransactionType>(); for (const name of names) { const type = await em.findOne(TransactionType, { name }); if (type) out.set(name, type); } return out; }
  private resolveSyncTarget(
    input: { connection: BankConnectionRef },
    deps: Deps,
  ): SyncTarget {
    if (!deps.provider) throw new InternalServerError('Bank sync provider is not configured');
    if (input.connection.status !== BankConnectionStatus.LINKED) throw new InternalServerError('Bank connection is not linked');
    return {
      appuserRef: input.connection.appuserId,
      client: deps.provider,
      connection: input.connection,
      requisitionId: input.connection.externalId,
      requisitionKey: input.connection.bankConnectionKey,
      transactionIdentity: deps.provider.transactionIdentity,
    };
  }
  // This does not write `balance` / `appuserCurrencyBalance`. Those are owned by the
  // whole-account chain rebuild that runs once per account after the persist loop — a batch cannot
  // know a row's position in the account's total order.
  // Leaving them out of `common` also means an in-place update never clobbers a good stored balance
  // with `undefined` if the rebuild later fails.
  private async persistTransaction(em: EntityManager, account: Account, tenant: AppuserTenant, row: BankSyncTransaction, pending: boolean, statuses: Record<'BOOKED' | 'PENDING', null | TransactionStatus>, types: Map<string, TransactionType>, metadataEnrichmentEnabled: boolean, enableBanking = false): Promise<{ created: number; createdTransaction?: Transaction; failed: number; skipped: number; tenantKey?: number }> {
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
    // The one resolver picks the rate; with none, no converted amount is stored (never the raw one).
    const resolvedRate = await resolveExchangeRate(em, currency, appuserCurrency, date, rateScope(tenant.tenantKey));
    const toAppuserCurrency = (value: number): null | number => (resolvedRate ? (sameCurrency ? value : convertMoney(value, resolvedRate.rate)) : null);
    const fxStatus = resolvedRate ? resolvedRate.status : FxStatus.MISSING;
    const settlementExchangeRate = tx.currencyExchange?.exchangeRate != null ? Number(tx.currencyExchange.exchangeRate) : undefined;
    const instructedAmount = tx.currencyExchange?.instructedAmount;
    const originalCurrencyCode = instructedAmount?.currency ?? tx.currencyExchange?.sourceCurrency ?? (settlementExchangeRate && tx.currencyExchange?.sourceCurrency && tx.currencyExchange.sourceCurrency !== currency.code ? tx.currencyExchange.sourceCurrency : undefined);
    const originalCurrencyKey = originalCurrencyCode ? await em.findOne(Currency, { code: originalCurrencyCode }) : currency;
    const originalAmount = instructedAmount?.amount != null
      ? Number(instructedAmount.amount)
      : settlementExchangeRate && tx.currencyExchange?.sourceCurrency && tx.currencyExchange.sourceCurrency !== currency.code
        ? Number(settlementAmountRaw) * settlementExchangeRate
        : Number(settlementAmountRaw);
    const appuserSettlementAmount = toAppuserCurrency(amount);
    const appuserCurrencyKey = appuser.currencyKey;
    const transactionMerchantKey = await this.resolveMerchant(em, tx);
    const metadata = this.buildTransactionMetadata(row, metadataEnrichmentEnabled);
    const common: EntityData<Transaction> = { accountKey: account, appuserCurrencyExchangeRate: sameCurrency ? undefined : resolvedRate?.rate, appuserCurrencyKey, appuserSettlementAmount, fxStatus, ...metadata, enableBankingTransactionId, externalTransactionId, internalTransactionId, nordigenInternalTransactionId, originalAmount: Number.isFinite(originalAmount) ? originalAmount : amount, originalCurrencyKey: originalCurrencyKey ?? currency, settlementAmount: amount, settlementCurrencyKey: currency, settlementExchangeRate, tenantKey: tenant.tenantKey, transactionDate: date, transactionMerchantKey, transactionStatusKey: status, transactionTypeKey: type };
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
        common.appuserSettlementAmount = toAppuserCurrency(editedAmount);
      }
      // The type is written when a row is created, and afterwards only by transfer matching
      // (which pairs and un-pairs rows, and re-types a legacy TRANSFER_IN credit). Re-fetching a row
      // must not undo a pair, or a type a user set.
      delete common.transactionTypeKey;
      Object.assign(existing as unknown as Record<string, unknown>, common);
      try {
        await em.persist(existing).flush();
      } catch (error) {
        return isDuplicate(error) ? { created: 0, failed: 0, skipped: 1 } : { created: 0, failed: 1, skipped: 0 };
      }
      // A split follows the bank's new amount: rescaled and back to the review inbox, or removed
      // when it can no longer be kept. An unchanged amount leaves it alone. Best-effort: the row is
      // stored either way, and every total shares the transaction's amount out by the lines'
      // proportions, so lines left unscaled still count the transaction exactly once.
      try {
        await reconcileSplitsWithAmount(em, existing, { actorType: TransactionAuditActorType.SYNC, source: 'transaction-splits-rescale' });
      } catch (error) {
        logger.warn({ error: sanitizeError(error), transactionKey: existing.transactionKey }, 'Rescaling a split transaction after sync failed');
      }
      return { created: 0, failed: 0, skipped: 0, tenantKey: existing.tenantKey?.tenantKey };
    }
    const transactionEntity = em.create(Transaction, { ...common, appuserKey: tenant.appuserKey }, { partial: true });
    try { await em.persist(transactionEntity).flush(); return { created: 1, createdTransaction: transactionEntity, failed: 0, skipped: 0, tenantKey: transactionEntity.tenantKey?.tenantKey }; } catch (error) { if (isDuplicate(error)) return { created: 0, failed: 0, skipped: 1 }; return { created: 0, failed: 1, skipped: 0 }; }
  }
  /**
   * A stored repeat of an id-less row (`<hash>:<n>`) that this fetch no longer reports: the fetch
   * holds fewer identical booked rows than the sync stored. The row is kept (a bank listing one of two
   * identical purchases is no proof the other did not happen) and a `DEDUP_SKIPPED` audit row flags it
   * for review. Booked rows only: a pending repeat that leaves the feed expires on its own. Only content
   * this fetch still reports is checked, so a row outside the fetch window is never flagged. Best-effort.
   */
  private async auditMissingOccurrences(em: EntityManager, account: Account, tenant: AppuserTenant, booked: BankSyncTransaction[], enableBanking: boolean): Promise<void> {
    const accountId = account.accountId ?? String(account.accountKey);
    const prefix = enableBanking ? 'enable_banking' : 'nordigen';
    const fetched = new Map<string, number>();
    for (const row of booked) { if (hasProviderId(row)) continue; const hash = stableContentHash(accountId, row); fetched.set(hash, (fetched.get(hash) ?? 0) + 1); }
    if (fetched.size === 0) return;
    try {
      const column = enableBanking ? 'enableBankingTransactionId' : 'nordigenInternalTransactionId';
      const stored = await em.find(Transaction, { accountKey: account, [column]: { $like: `${prefix}:%:%` }, deletedAt: undefined }, { filters: { [HIDDEN_FILTER]: false }, populate: ['transactionStatusKey'] });
      for (const row of stored) {
        const occurrence = parseOccurrenceId(row[column], prefix);
        const count = occurrence ? fetched.get(occurrence.hash) : undefined;
        if (!occurrence || count === undefined || occurrence.index < count || row.transactionStatusKey?.name !== 'BOOKED') continue;
        await TransactionAuditService.log(em, { accountKey: account.accountKey, actorType: TransactionAuditActorType.SYNC, appuserKey: getAppuserKey(row.appuserKey ?? tenant.appuserKey), changes: { occurrence: { from: null, to: occurrence.index }, occurrencesFetched: { from: null, to: count }, reason: { from: null, to: 'occurrence_missing_from_fetch' } }, eventType: TransactionAuditEventType.DEDUP_SKIPPED, source: 'account-initial-sync:occurrence-missing', tenantKey: row.tenantKey?.tenantKey ?? tenant.tenantKey.tenantKey, transactionKey: row.transactionKey });
      }
    } catch (error) { logger.warn({ error: sanitizeError(error) }, 'Auditing missing id-less repeats failed'); }
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
   * Promote matched pending rows in place. For each booked row that uniquely matches a stored
   * pending (exact amount/currency/counterparty, ±5d, then a looser amount/merchant pass when no
   * exact match exists), set that pending's provider id to the booked row's, so the subsequent
   * persist loop finds it and updates it in place (status→BOOKED, balance, date, amount) —
   * preserving the user's category/notes and never creating a duplicate. Returns the keys of the
   * pendings it promoted or expired (so expiry skips them).
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
      const storedPendings = await em.find(Transaction, { accountKey: account, deletedAt: undefined, transactionStatusKey: statuses.pending }, { filters: { [HIDDEN_FILTER]: false }, populate: ['settlementCurrencyKey', 'transactionMerchantKey'] });
      if (storedPendings.length === 0) return handled;
      const bookedMatchables = booked.map((row) => { const tx = row as Partial<BankSyncTransaction>; return { counterparty: tx.creditorName ?? tx.debtorName ?? undefined, currencyCode: tx.transactionAmount?.currency ?? tx.currency ?? '', settlementAmount: Number(tx.transactionAmount?.amount ?? tx.amount), transactionDate: rowDate(tx) }; });
      const pendingMatchables = storedPendings.map((pending) => ({ counterparty: pending.transactionMerchantKey?.name, currencyCode: pending.settlementCurrencyKey?.code ?? '', settlementAmount: pending.settlementAmount ?? 0, transactionDate: pending.transactionDate ?? new Date(0), transactionKey: pending.transactionKey }));
      plan = planPromotions(bookedMatchables, pendingMatchables);
      pendingByKey = new Map(storedPendings.map((pending) => [pending.transactionKey, pending]));
    } catch (error) { logger.warn({ error: sanitizeError(error) }, 'Pending promotion failed'); return handled; }
    for (const { amountDifference, bookedIndex, matchPass, pendingKey } of plan) {
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
        const bookedAmount = Number(tx.transactionAmount?.amount ?? tx.amount);
        const changes: Record<string, { from: unknown; to: unknown }> = {
          amountDifference: { from: null, to: amountDifference },
          matchPass: { from: null, to: matchPass },
          transactionStatusKey: { from: 'PENDING', to: 'BOOKED' },
        };
        if (matchPass === 'loose' && Number.isFinite(bookedAmount)) changes['settlementAmount'] = { from: pending.settlementAmount ?? 0, to: bookedAmount };
        await TransactionAuditService.log(em, { accountKey: account.accountKey, actorType: TransactionAuditActorType.SYNC, appuserKey: getAppuserKey(tenant.appuserKey), changes, eventType: TransactionAuditEventType.PENDING_PROMOTED, source: 'pending-reconciliation', tenantKey: pending.tenantKey?.tenantKey ?? 0, transactionKey: pendingKey });
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
 *
 * Two id-less rows with identical content (two coffees, same shop, same day) hash alike, so the nth
 * repeat in one fetch (`stableIdOccurrence`, set by `withStableIdOccurrences`) is `<hash>:<n>`. The
 * first keeps the bare hash: every id-less row stored before repeats were numbered is keyed by it and
 * keeps its identity. Exported for the status repair, which must find stored rows exactly as the sync does.
 */
export function buildStableId(accountId: string, row: BankSyncTransaction, prefix: 'enable_banking' | 'nordigen' = 'nordigen') { const transaction = row as Partial<BankSyncTransaction>; const preferred = providerIdOf(transaction); if (preferred) return `${prefix}:${preferred}`; const hash = stableContentHash(accountId, transaction); const occurrence = transaction.stableIdOccurrence ?? 0; return occurrence > 0 ? `${prefix}:${hash}:${occurrence}` : `${prefix}:${hash}`; }

/**
 * Copies of one fetched list's rows (booked, pending or voided), each id-less row numbered among the
 * rows of identical content before it. Identical rows are interchangeable, so which one gets which
 * number does not matter, and a later fetch of the same rows maps them onto the same ids. Rows with a
 * provider id are returned as they are.
 */
export function withStableIdOccurrences<T extends BankSyncTransaction>(accountId: string, rows: T[]): T[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    if (hasProviderId(row)) return row;
    const hash = stableContentHash(accountId, row);
    const occurrence = seen.get(hash) ?? 0;
    seen.set(hash, occurrence + 1);
    return { ...row, stableIdOccurrence: occurrence };
  });
}

/** The provider id `buildStableId` prefers over the hash; a row without one is "id-less". */
function hasProviderId(row: Partial<BankSyncTransaction>) { return Boolean(providerIdOf(row)); }
function providerIdOf(row: Partial<BankSyncTransaction>) { return row.transactionId ?? row.internalTransactionId ?? row.entryReference; }

/** The hash of the fields that identify an id-less row. */
function stableContentHash(accountId: string, row: Partial<BankSyncTransaction>): string { return crypto.createHash('sha256').update(JSON.stringify({ accountId, amount: row.stableIdFields?.amount ?? row.transactionAmount?.amount ?? row.amount ?? null, bookingDate: row.bookingDate ?? null, creditorName: row.creditorName ?? null, creditorReference: row.creditorReference ?? null, currency: row.transactionAmount?.currency ?? row.currency ?? null, debit: (row.stableIdFields ? row.stableIdFields.creditDebitIndicator : row.creditDebitIndicator) ?? null, debtorName: row.debtorName ?? null, remittance: row.remittanceInformationUnstructured ?? null, remittanceStructured: row.remittanceInformationStructured ?? null, valueDate: row.valueDate ?? null })).digest('hex'); }

/** A numbered repeat's id, `<prefix>:<hash>:<n>`, split into its hash and number. */
function parseOccurrenceId(id: null | string | undefined, prefix: string): undefined | { hash: string; index: number } {
  const match = id?.startsWith(`${prefix}:`) ? /^([0-9a-f]{64}):(\d+)$/.exec(id.slice(prefix.length + 1)) : null;
  return match?.[1] && match[2] ? { hash: match[1], index: Number(match[2]) } : undefined;
}

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
