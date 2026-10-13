import crypto from 'node:crypto';

import { type EntityData, type EntityManager, type FilterQuery, UniqueConstraintViolationException } from '@mikro-orm/core';
import * as Sentry from '@sentry/node';
import { generateInternalTransactionId } from '@wondermoney/shared';

import { DI } from '@app/database/di';
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
import { createEnableBankingSyncAdapter } from '@service/enable-banking/enable-banking-sync-adapter';
import backgroundOperationService from '@service/operations/background-operation.service';
import type { Enqueue } from '@service/queue/enqueue';
import { triggerRecurringDetectionAfterTransactionIngestion } from '@service/recurring/post-transaction-ingestion-detection.service';
import { enqueueTransactionEnrichmentForTenant } from '@service/transaction-enrichment/transaction-enrichment-enqueue.service';
import { recalculateChainFromAccountBalance } from '@service/transaction/balance-chain.service';
import { applyCategorizationOutcome } from '@service/transaction/categorization-confidence';
import { DEFAULT_PENDING_GRACE_DAYS, logDryRunExpirations, planPendingExpirations } from '@service/transaction/pending-expiry.service';
import { getReconciliationMode, logDryRunPromotions, planPromotions } from '@service/transaction/pending-reconciliation.service';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { findExistingTransactionWithProvenance } from '@service/transaction/transaction-dedup.service';
import deterministicCategorizationService from '@service/transaction/transaction-deterministic-categorization.service';
import { enrichTransactionMetadata, isTransactionMetadataEnrichmentEnabled } from '@service/transaction/transaction-metadata-enrichment.service';
import { sanitizeProviderResponse } from '@utils/error-sanitizer';
import { InternalServerError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';
import { convertMoney } from '@utils/money';

/** See the identical note in `account-initial-sync-account.service.ts` — `requisitionId`/
 * `requisitionKey` are provider-agnostic sync-target identity fields as of Phase 1d. */
export interface AccountInitialSyncTransactionsResult { accountsFailed: number; accountsProcessed: number; accountsTotal: number; appuserKey: number; failedAccountIds: string[]; requisitionId: string; requisitionKey: number; status: 'completed' | 'failed' | 'partial'; transactionsCategorized: number; transactionsCreated: number; transactionsFailed: number; transactionsFetched: number; transactionsSkipped: number; }

interface BankSyncClient { account: (accountId: string) => { getTransactions: (input?: { country?: string; dateFrom?: string; dateTo?: string }) => Promise<BankSyncTransactionsResponse> }; }
/** Berlin-Group-shaped transaction row. Both bank providers normalise into this shape;
 * declared locally so the app carries no dependency on any provider SDK's types. */
interface BankSyncTransaction { amount?: string; bookingDate?: string; creditDebitIndicator?: string; creditorName?: string; creditorReference?: string; currency?: string; currencyExchange?: { exchangeRate?: number | string; instructedAmount?: { amount?: string; currency?: string }; sourceCurrency?: string }; debtorName?: string; entryReference?: string; internalTransactionId?: string; remittanceInformationStructured?: string; remittanceInformationUnstructured?: string; transactionAmount?: { amount?: string; currency?: string }; transactionId?: string; valueDate?: string }
interface BankSyncTransactionsResponse { transactions?: { booked?: BankSyncTransaction[]; pending?: BankSyncTransaction[] } }
interface Deps { backgroundOperationService?: typeof backgroundOperationService; em?: EntityManager; enableBankingSyncAdapterFactory?: (connection: EnableBankingConnection) => Promise<BankSyncClient>; enqueue?: Enqueue; logger?: Pick<typeof logger, 'error' | 'info' | 'warn'>;  }

/** Phase 1d client-construction seam — see the identical-purpose `SyncTarget` in
 * `account-initial-sync-account.service.ts` for the full rationale. */
interface SyncTarget { appuserRef: Appuser; client: BankSyncClient; enableBanking: boolean; requisitionId: string; requisitionKey: number; }

const DUPLICATE_ERROR_CODES = new Set(['23505']);

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
        const transactions = response.transactions as Partial<{ booked?: BankSyncTransaction[]; pending?: BankSyncTransaction[] }> | undefined;
        const booked = transactions?.booked ?? [];
        const pending = transactions?.pending ?? [];
        // RAD-346 Phase 4: pending→posted reconciliation. `apply` promotes/expires in place (live);
        // `dry_run` only logs intended changes. Off = kill switch. Always before the persist loop so a
        // promoted pending is then found by provider-id dedup and updated (never duplicated).
        if (reconciliationMode !== 'off' && txnStatusPending) {
          const seenPendingIdentities = new Set<string>();
          for (const row of pending) { const tx = row as Partial<BankSyncTransaction>; for (const id of [tx.transactionId, tx.internalTransactionId, tx.entryReference]) if (id) seenPendingIdentities.add(id); }
          if (reconciliationMode === 'apply') {
            const promotedKeys = await this.applyPromotions(em, account, tenant, booked, txnStatusPending, enableBanking);
            if (txnStatusExpired) await this.applyExpirations(em, account, txnStatusPending, txnStatusExpired, seenPendingIdentities, promotedKeys);
          } else {
            const bookedMatchables = booked
              .map((row) => { const tx = row as Partial<BankSyncTransaction>; return { counterparty: tx.creditorName ?? tx.debtorName ?? undefined, currencyCode: tx.transactionAmount?.currency ?? tx.currency ?? '', settlementAmount: Number(tx.transactionAmount?.amount ?? tx.amount), transactionDate: new Date(tx.bookingDate ?? tx.valueDate ?? '') }; })
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
        // RAD-564: the running balance is a chain over the whole account, not a per-batch suffix.
        // Persisting the batch above leaves the newly created rows without a balance and the rows it
        // updated with a stale one, so the chain is rebuilt here — every settled row on the account,
        // in `(transactionDate, transactionKey)` order, anchored on the provider's `account.balance`.
        //
        // Runs even when the batch is empty, and that is the point of putting it here: the account
        // phase has just written a fresh provider balance, so an idle account whose chain used to end
        // on the *previous* balance is exactly the case where `account.balance` and the top of the
        // transactions list silently disagreed. Inside the try so a failure marks the account failed
        // rather than leaving a half-written chain.
        const { changed: rewritten } = await recalculateChainFromAccountBalance(em, account);
        if (rewritten > 0) log.info({ accountId: account.accountId, rewritten }, 'Rebuilt account running-balance chain');
        if (rows.length === 0) { processedAccountIds.add(account.accountId ?? String(account.accountKey)); continue; }
        if (input.correlationId && input.queueJobId) await bg.heartbeatJob(input.correlationId, input.queueJobId, { progress: { accountsProcessed: processedAccountIds.size, accountsTotal: accounts.length, failedAccountIds, transactionsCategorized, transactionsCreated, transactionsFailed, transactionsFetched, transactionsSkipped }, stage: 'account.initial-sync:syncing-transactions' });
      } catch (error) {
        failedAccountIds.push(account.accountId ?? String(account.accountKey)); transactionsFailed += 1;
        log.warn({ accountId: account.accountId, error: sanitizeError(error) }, 'Account initial sync transaction fetch failed');
        // RAD-519: this only ever logged, so the 48-incident data_validation cluster had no Sentry
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
      if (accountFailed > 0) failedAccountIds.push(account.accountId ?? String(account.accountKey)); else if (accountCreated > 0 || accountSkipped > 0) processedAccountIds.add(account.accountId ?? String(account.accountKey));
    }

    // RAD-346 Phase 1: mark successfully-synced accounts fresh so the accounts DTO can derive staleness.
    // Best-effort — a freshness-marker write must never fail the sync it describes.
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
    // RAD-414: best-effort, fail-open shadow enrichment enqueue. Dormant by default; never blocks sync.
    for (const tenantKey of affectedTenantKeys) await enqueueTransactionEnrichmentForTenant(tenantKey, 'account-initial-sync', { enqueue: deps.enqueue });
    const status = failedAccountIds.length === accounts.length ? 'failed' : failedAccountIds.length > 0 ? 'partial' : 'completed';
    return { accountsFailed: failedAccountIds.length, accountsProcessed: processedAccountIds.size, accountsTotal: accounts.length, appuserKey: getAppuserKey(appuserRef), failedAccountIds, requisitionId, requisitionKey, status, transactionsCategorized, transactionsCreated, transactionsFailed, transactionsFetched, transactionsSkipped };
  }

  /** See `account-initial-sync-account.service.ts`'s identical-purpose `resolveSyncTarget`. */
  private buildGeneratedInternalTransactionId(row: BankSyncTransaction) { const transaction = row as Partial<BankSyncTransaction>; const amount = Number(transaction.transactionAmount?.amount ?? transaction.amount); const date = new Date(transaction.bookingDate ?? transaction.valueDate ?? ''); if (!Number.isFinite(amount) || Number.isNaN(date.getTime())) return undefined; try { return generateInternalTransactionId(date, amount); } catch { return undefined; } }

  private buildStableId(accountId: string, row: BankSyncTransaction, prefix: 'enable_banking' | 'nordigen' = 'nordigen') { const transaction = row as Partial<BankSyncTransaction>; const preferred = transaction.transactionId ?? transaction.internalTransactionId ?? transaction.entryReference; if (preferred) return `${prefix}:${preferred}`; const hash = crypto.createHash('sha256').update(JSON.stringify({ accountId, amount: transaction.transactionAmount?.amount ?? transaction.amount ?? null, bookingDate: transaction.bookingDate ?? null, creditorName: transaction.creditorName ?? null, creditorReference: transaction.creditorReference ?? null, currency: transaction.transactionAmount?.currency ?? transaction.currency ?? null, debit: transaction.creditDebitIndicator ?? null, debtorName: transaction.debtorName ?? null, remittance: transaction.remittanceInformationUnstructured ?? null, remittanceStructured: transaction.remittanceInformationStructured ?? null, valueDate: transaction.valueDate ?? null })).digest('hex'); return `${prefix}:${hash}`; }
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
  // RAD-564: this no longer writes `balance` / `appuserCurrencyBalance`. Those are owned by the
  // whole-account chain rebuild that runs once per account after the persist loop — a batch cannot
  // know a row's position in the account's total order, which is exactly what went wrong before.
  // Leaving them out of `common` also means an in-place update never clobbers a good stored balance
  // with `undefined` if the rebuild later fails.
  private async persistTransaction(em: EntityManager, account: Account, tenant: AppuserTenant, row: BankSyncTransaction, pending: boolean, statuses: Record<'BOOKED' | 'PENDING', null | TransactionStatus>, types: Map<string, TransactionType>, metadataEnrichmentEnabled: boolean, enableBanking = false): Promise<{ categorized?: number; created: number; failed: number; skipped: number; tenantKey?: number }> {
    const tx = row as Partial<BankSyncTransaction>; const settlementCurrencyCode = tx.transactionAmount?.currency ?? tx.currency; if (!settlementCurrencyCode) return { created: 0, failed: 1, skipped: 0 };
    const currency = await em.findOne(Currency, { code: settlementCurrencyCode }); if (!currency) return { created: 0, failed: 1, skipped: 0 };
    const status = pending ? statuses.PENDING : statuses.BOOKED; if (!status) return { created: 0, failed: 1, skipped: 0 };
    const type = this.resolveType(row, types); if (!type) return { created: 0, failed: 1, skipped: 0 };
    const settlementAmountRaw = tx.transactionAmount?.amount ?? tx.amount; const amount = Number(settlementAmountRaw); if (!Number.isFinite(amount)) return { created: 0, failed: 1, skipped: 0 };
    const date = new Date(tx.bookingDate ?? tx.valueDate ?? ''); if (Number.isNaN(date.getTime())) return { created: 0, failed: 1, skipped: 0 };
    const externalTransactionId = tx.transactionId;
    // Phase 1d: Enable Banking rows get their own `enableBankingTransactionId` column
    // (`transaction_id`, falling back to `entry_reference`, then a stable hash) — the
    // `nordigenInternalTransactionId` column and its dedup branch are untouched for these rows,
    // per plan §2/§3 ("do NOT touch that old column or its dedup logic").
    const stableId = this.buildStableId(account.accountId ?? String(account.accountKey), row, enableBanking ? 'enable_banking' : 'nordigen');
    const nordigenInternalTransactionId = enableBanking ? undefined : (tx.internalTransactionId ?? tx.transactionId ?? tx.entryReference ?? stableId);
    const enableBankingTransactionId = enableBanking ? (tx.transactionId ?? tx.entryReference ?? stableId) : undefined;
    const generatedInternalTransactionId = this.buildGeneratedInternalTransactionId(row);
    const internalTransactionId = generatedInternalTransactionId ?? nordigenInternalTransactionId ?? enableBankingTransactionId;
    // RAD-346 Phase 2: shared dedup — same deterministic identity check, now centralized.
    // RAD-394: use the provenance variant so we can emit a DEDUP_SKIPPED audit row indicating
    // *which* identity branch matched (external / nordigen / internal). The `internal` branch
    // matching on a row with a *different* bank id is the false-positive-skip case that
    // RAD-393 needs telemetry on.
    const existingMatch = await findExistingTransactionWithProvenance(em, { accountKey: account, enableBankingTransactionId, externalTransactionId, internalTransactionId: generatedInternalTransactionId, nordigenInternalTransactionId });
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
      // RAD-394: emit a DEDUP_SKIPPED audit row so we can measure the false-positive-skip
      // rate (matchedOn=internalTransactionId with a *different* bank id on the existing row).
      // Best-effort: the audit service never throws, and the write is inside the same em.
      await TransactionAuditService.log(em, {
        accountKey: account.accountKey,
        actorType: TransactionAuditActorType.SYNC,
        appuserKey: getAppuserKey(tenant.appuserKey),
        changes: {
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
      Object.assign(existing as unknown as Record<string, unknown>, common); try { await em.persist(existing).flush(); return { created: 0, failed: 0, skipped: 0, tenantKey: existing.tenantKey?.tenantKey }; } catch (error) { return isDuplicate(error) ? { created: 0, failed: 0, skipped: 1 } : { created: 0, failed: 1, skipped: 0 }; }
    }
    const transactionEntity = em.create(Transaction, { ...common, appuserKey: tenant.appuserKey }, { partial: true });
    try { await em.persist(transactionEntity).flush(); const categorized = transactionMerchantKey ? await this.categorizeIfEnabled(em, tenant.appuserKey, transactionEntity) : 0; return { categorized, created: 1, failed: 0, skipped: 0, tenantKey: transactionEntity.tenantKey?.tenantKey }; } catch (error) { if (isDuplicate(error)) return { categorized: 0, created: 0, failed: 0, skipped: 1 }; return { categorized: 0, created: 0, failed: 1, skipped: 0 }; }
  }
  /**
   * RAD-346 Phase 4 (live): promote matched pending rows in place. For each booked row that
   * uniquely matches a stored pending (exact amount/currency/counterparty, ±5d), set that pending's
   * provider id to the booked row's, so the subsequent persist loop finds it and updates it in place
   * (status→BOOKED, balance, date, amount) — preserving the user's category/notes and never creating
   * a duplicate. Returns the set of promoted pending keys (so expiry skips them). Best-effort.
   */
  private async applyPromotions(em: EntityManager, account: Account, tenant: AppuserTenant, booked: BankSyncTransaction[], pendingStatus: TransactionStatus, enableBanking = false): Promise<Set<number>> {
    const promoted = new Set<number>();
    try {
      const storedPendings = await em.find(Transaction, { accountKey: account, deletedAt: undefined, transactionStatusKey: pendingStatus }, { populate: ['settlementCurrencyKey'] });
      if (storedPendings.length === 0) return promoted;
      const bookedMatchables = booked.map((row) => { const tx = row as Partial<BankSyncTransaction>; return { counterparty: tx.creditorName ?? tx.debtorName ?? undefined, currencyCode: tx.transactionAmount?.currency ?? tx.currency ?? '', settlementAmount: Number(tx.transactionAmount?.amount ?? tx.amount), transactionDate: new Date(tx.bookingDate ?? tx.valueDate ?? '') }; });
      const pendingMatchables = storedPendings.map((pending) => ({ currencyCode: pending.settlementCurrencyKey?.code ?? '', settlementAmount: pending.settlementAmount ?? 0, transactionDate: pending.transactionDate ?? new Date(0), transactionKey: pending.transactionKey }));
      const plan = planPromotions(bookedMatchables, pendingMatchables);
      const pendingByKey = new Map(storedPendings.map((pending) => [pending.transactionKey, pending]));
      for (const { bookedIndex, pendingKey } of plan) {
        const pending = pendingByKey.get(pendingKey); const row = booked[bookedIndex];
        if (!pending || !row) continue;
        const tx = row as Partial<BankSyncTransaction>;
        // Phase 1d: promote into the provider-matching column only — see `persistTransaction`'s
        // identical column split.
        if (enableBanking) pending.enableBankingTransactionId = tx.transactionId ?? tx.entryReference ?? this.buildStableId(account.accountId ?? String(account.accountKey), row, 'enable_banking');
        else pending.nordigenInternalTransactionId = tx.internalTransactionId ?? tx.transactionId ?? tx.entryReference ?? this.buildStableId(account.accountId ?? String(account.accountKey), row, 'nordigen');
        await em.persist(pending).flush();
        promoted.add(pendingKey);
        await TransactionAuditService.log(em, { accountKey: account.accountKey, actorType: TransactionAuditActorType.SYNC, appuserKey: getAppuserKey(tenant.appuserKey), changes: { transactionStatusKey: { from: 'PENDING', to: 'BOOKED' } }, eventType: TransactionAuditEventType.PENDING_PROMOTED, source: 'pending-reconciliation', tenantKey: pending.tenantKey?.tenantKey ?? 0, transactionKey: pendingKey });
      }
    } catch (error) { logger.warn({ error: sanitizeError(error) }, 'Pending promotion failed'); }
    return promoted;
  }

  /**
   * RAD-346 Phase 4 (live): expire ghost pendings — stored PENDING rows that dropped out of the feed
   * and are past the grace window move to EXPIRED (hidden, auditable). Skips rows just promoted this
   * sync. Pending rows carry no running balance, so this is a status change only. Best-effort.
   */
  private async applyExpirations(em: EntityManager, account: Account, pendingStatus: TransactionStatus, expiredStatus: TransactionStatus, seenIdentities: Set<string>, promotedKeys: Set<number>): Promise<void> {
    try {
      const storedPendings = await em.find(Transaction, { accountKey: account, deletedAt: undefined, transactionStatusKey: pendingStatus });
      if (storedPendings.length === 0) return;
      const expirable = storedPendings
        .filter((pending) => !promotedKeys.has(pending.transactionKey))
        // `enableBankingTransactionId` added alongside the two originals (Phase 1d) — additive
        // only, `planPendingExpirations` already ignores null/undefined entries, so this changes
        // nothing for GoCardless-sourced pendings (always null on that column).
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
  private resolveType(row: BankSyncTransaction, types: Map<string, TransactionType>) { const credit = (row.creditDebitIndicator ?? '').toLowerCase() === 'credit'; return credit ? types.get('TRANSFER_IN') ?? null : types.get('PAYMENT') ?? types.get('CARD_PAYMENT') ?? null; }
}

function dateOffset(date: Date, days: number) { const copy = new Date(date); copy.setDate(copy.getDate() - days); return isoDate(copy); }
function getAppuserKey(appuserKey?: unknown): number { if (typeof appuserKey === 'number') return appuserKey; if (appuserKey && typeof appuserKey === 'object' && typeof (appuserKey as { appuserKey?: unknown }).appuserKey === 'number') return (appuserKey as { appuserKey: number }).appuserKey; return 0; }
function isDuplicate(error: unknown) { if (error instanceof UniqueConstraintViolationException) return true; if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' && DUPLICATE_ERROR_CODES.has((error as { code: string }).code)) return true; if (error instanceof Error && /unique|duplicate/i.test(error.message)) return true; return false; }
function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function sanitizeDirty(value?: string): string | undefined { if (!value) return undefined; return value.normalize('NFKC').split('').map((char) => { const code = char.charCodeAt(0); return code <= 31 || code === 127 ? ' ' : char; }).join('').replace(/\s+/g, ' ').trim().slice(0, 255) || undefined; }
function sanitizeError(error: unknown) { if (!error || typeof error !== 'object') return { message: String(error) }; const safe = error as { code?: unknown; message?: unknown; name?: unknown; status?: unknown }; return { code: typeof safe.code === 'string' ? safe.code : undefined, message: typeof safe.message === 'string' ? safe.message : undefined, name: typeof safe.name === 'string' ? safe.name : undefined, providerResponse: sanitizeProviderResponse(error), status: typeof safe.status === 'number' || typeof safe.status === 'string' ? safe.status : undefined }; }
function sanitizeMerchantName(value?: string) { return value ? value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 255) || undefined : undefined; }

export default new AccountInitialSyncTransactionService();
