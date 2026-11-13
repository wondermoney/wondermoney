import { randomUUID } from 'node:crypto';

import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { enqueueAccountRecalculateJob } from '@app/jobs/account-recalculate.queue';
import { Account } from '@entity/Account';
import { AppuserTenant } from '@entity/AppuserTenant';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import type { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { accountAccessOf, canWrite } from '@service/account/account-access';
import { convertWithStatus, rateScope } from '@service/currency/exchange-rate';
import { reconvertAccountRows } from '@service/currency/fx-reconvert.service';
import backgroundOperationService from '@service/operations/background-operation.service';
import type { Enqueue } from '@service/queue/enqueue';
import { isManualAccount, loadChainRows, recalculateChainFromAccountBalance } from '@service/transaction/balance-chain.service';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import { ERROR_CODE, TooManyRequestsError } from '@utils/errors';
import logger from '@utils/logger';

/**
 * "Recalculate balances": the self-service fix for an account whose running balances went wrong.
 *
 * It rebuilds the account's chain through the same code every writer uses
 * (`balance-chain.service.ts`), anchored where that module says: a manual or CSV account on its
 * opening balance, with `account.balance` then set to the chain's tail; a bank-synced account on
 * the provider's balance, which is never overwritten. Before that, rows stored without a usable
 * rate are converted again where one now exists (the same pass as `fx-reconvert.service.ts`), and
 * afterwards the balance in the owner's currency is refreshed at the latest rate. Every row whose
 * stored balance moves gets a system `balance_recalc` audit entry, and the run reports how many
 * rows changed and the balance before and after. On an account that is already right it changes
 * nothing, so it can be run as often as anyone likes.
 *
 * Who may start it: any household member who can see the account. The controller looks the account
 * up through the tenant filter, so the other member's private account (and any other household's)
 * is a 404. The job checks again, under the account's row lock, that the member who started it can
 * still see it.
 *
 * Concurrency: the rebuild runs in one database transaction holding the account's row lock, the
 * lock bank sync, transaction edits and `fx.reconvert` also take, so two runs on one account (or a
 * run and a sync) take turns and each sees the other's committed result. Starts are serialised per
 * account with an advisory lock: a member with a run still queued gets that run back instead of a
 * second one, and an account can be started at most once a minute. An opening balance edit skips
 * that limit, since it needs a rebuild to take effect.
 */

export const ACCOUNT_RECALCULATION_OPERATION = 'account.recalculate';
export const ACCOUNT_RECALCULATION_AUDIT_SOURCE = 'account-recalculate';
/** The shortest gap between two starts on one account. */
export const RECALCULATION_INTERVAL_SECONDS = 60;
/** Advisory-lock namespace that serialises an account's recalculation starts (any constant int4). */
const START_LOCK_NAMESPACE = 650_067;
/** Balances are `numeric(18, 4)`; anything under half a hundredth of a cent is float noise. */
const BALANCE_TOLERANCE = 0.005;

export interface AccountRecalculationScope {
  accountKey: number;
  /** The member starting it. */
  appuserKey: number;
  tenantKey: number;
}

/** What a run changed: the operation's `progress` once it has finished. */
export interface AccountRecalculationResult {
  accountKey: number;
  /** Rows stored without a usable rate that a rate now converts. */
  amountsReconverted: number;
  /** The owner's currency, which `appuserCurrencyBalance*` are in. */
  appuserCurrency: null | string;
  appuserCurrencyBalanceAfter: null | number;
  appuserCurrencyBalanceBefore: null | number;
  balanceAfter: null | number;
  balanceBefore: null | number;
  /** The account's own currency, which `balance*` are in. */
  currency: string;
  /** Chain rows whose stored balance or converted amount changed. */
  rowsChanged: number;
  /** Chain rows gone through: every settled, dated row on the account. */
  rowsScanned: number;
}

const resourceIdOf = (accountKey: number) => `account:${accountKey}`;

function accountKeyOf(resourceId: string): null | number {
  const match = /^account:(\d+)$/.exec(resourceId);
  return match ? Number(match[1]) : null;
}

/**
 * Rebuild one account's balances, in its own database transaction under its row lock. Returns
 * null, having changed nothing, when the account is gone or `visibleTo` can no longer see it.
 */
export async function recalculateAccount(
  em: EntityManager,
  accountKey: number,
  options: { now?: Date; visibleTo?: Omit<AccountRecalculationScope, 'accountKey'> } = {},
): Promise<AccountRecalculationResult | null> {
  const now = options.now ?? new Date();
  return em.fork().transactional(async (tx) => {
    // A system pass (no tenant context): the account is found by key, and `visibleTo` is the
    // tenancy check.
    const account = await tx.findOne(Account, { accountKey, deletedAt: null }, { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE });
    if (!account) return null;
    if (options.visibleTo && !(await isVisibleTo(tx, account, options.visibleTo))) return null;
    await tx.populate(account, ['currencyKey', 'accountOwnerAppuserKey.currencyKey'], { filters: false });

    const before = { appuserCurrencyBalance: account.appuserCurrencyBalance ?? null, balance: account.balance ?? null };
    const rows = await loadChainRows(tx, account, { transactionDate: { $ne: null } });
    const stored = new Map(rows.map((row) => [row.transactionKey, snapshot(row)]));

    const { reconverted } = await reconvertAccountRows(tx, account, ACCOUNT_RECALCULATION_AUDIT_SOURCE);

    if (isManualAccount(account)) {
      // A manual account's balance is derived: the chain's tail, or the opening balance itself
      // when there is nothing on top of it.
      if (rows.length > 0) account.balance = (await recalculateChainFromAccountBalance(tx, account)).tail.balance;
      else if (account.openingBalance != null) account.balance = account.openingBalance;
    }
    await refreshOwnerCurrencyBalance(tx, account, now);
    // Again, anchored on the refreshed figures: a chain in another currency than the owner's ends
    // on the balance in the owner's currency.
    if (rows.length > 0) await recalculateChainFromAccountBalance(tx, account);

    let rowsChanged = 0;
    for (const row of rows) {
      const was = stored.get(row.transactionKey);
      const after = snapshot(row);
      if (!was || !changed(was, after)) continue;
      rowsChanged += 1;
      // A converted amount is audited by the re-conversion itself; this records the balances.
      const appuserKey = row.appuserKey?.appuserKey ?? account.accountOwnerAppuserKey?.appuserKey;
      if (appuserKey === undefined || (!moved(was.balance, after.balance) && !moved(was.appuserCurrencyBalance, after.appuserCurrencyBalance))) continue;
      await TransactionAuditService.log(tx, {
        accountKey: account.accountKey,
        actorType: TransactionAuditActorType.SYSTEM,
        appuserKey,
        changes: {
          appuserCurrencyBalance: { from: was.appuserCurrencyBalance, to: after.appuserCurrencyBalance },
          balance: { from: was.balance, to: after.balance },
        },
        eventType: TransactionAuditEventType.BALANCE_RECALC,
        source: ACCOUNT_RECALCULATION_AUDIT_SOURCE,
        tenantKey: account.tenantKey.tenantKey,
        transactionKey: row.transactionKey,
      }, { flush: false });
    }
    await tx.flush();

    return {
      accountKey: account.accountKey,
      amountsReconverted: reconverted,
      appuserCurrency: account.accountOwnerAppuserKey?.currencyKey.code ?? null,
      appuserCurrencyBalanceAfter: account.appuserCurrencyBalance ?? null,
      appuserCurrencyBalanceBefore: before.appuserCurrencyBalance,
      balanceAfter: account.balance ?? null,
      balanceBefore: before.balance,
      currency: account.currencyKey.code,
      rowsChanged,
      rowsScanned: rows.length,
    };
  });
}

/**
 * Queue a recalculation of one account and return the operation id `GET /v1/operations/:id`
 * reports on. The caller has already found the account through the tenant filter. A member who
 * still has one queued for the account gets that one back. Otherwise, unless `rateLimited` is
 * false, a start less than {@link RECALCULATION_INTERVAL_SECONDS} after the account's last one
 * throws `TooManyRequestsError` (`account_recalculation_too_soon`) with the seconds to wait.
 */
export async function startAccountRecalculation(
  em: EntityManager,
  scope: AccountRecalculationScope,
  deps: { enqueue: Enqueue },
  options: { now?: Date; rateLimited?: boolean } = {},
): Promise<{ operationId: string }> {
  const now = options.now ?? new Date();
  const resourceId = resourceIdOf(scope.accountKey);

  const start = await em.fork().transactional(async (tx) => {
    const connection = tx.getConnection();
    const context = tx.getTransactionContext();
    await connection.execute('select pg_advisory_xact_lock(?, ?)', [START_LOCK_NAMESPACE, scope.accountKey], 'all', context);
    const queued = await connection.execute<{ correlation_id: string }[]>(
      `select correlation_id from background_operation
       where operation_type = ? and resource_id = ? and appuser_key = ? and status = 'queued' and deleted_at is null
       order by queued_at desc limit 1`,
      [ACCOUNT_RECALCULATION_OPERATION, resourceId, scope.appuserKey],
      'all',
      context,
    );
    if (queued[0]) return { created: false, operationId: queued[0].correlation_id };

    if (options.rateLimited !== false) {
      const latest = await connection.execute<{ queued_at: Date | string }[]>(
        `select queued_at from background_operation
         where operation_type = ? and resource_id = ? and deleted_at is null
         order by queued_at desc limit 1`,
        [ACCOUNT_RECALCULATION_OPERATION, resourceId],
        'all',
        context,
      );
      const elapsedSeconds = latest[0] ? (now.getTime() - new Date(latest[0].queued_at).getTime()) / 1000 : Infinity;
      if (elapsedSeconds < RECALCULATION_INTERVAL_SECONDS) {
        throw new TooManyRequestsError('This account was recalculated less than a minute ago', Math.max(1, Math.ceil(RECALCULATION_INTERVAL_SECONDS - elapsedSeconds)), ERROR_CODE.ACCOUNT_RECALCULATION_TOO_SOON);
      }
    }

    const operationId = `${ACCOUNT_RECALCULATION_OPERATION}:${randomUUID()}`;
    const operation = await backgroundOperationService.createQueuedOperation(
      { appuserKey: scope.appuserKey, correlationId: operationId, operationType: ACCOUNT_RECALCULATION_OPERATION, resourceId, retryable: false, tenantKey: scope.tenantKey },
      tx,
    );
    // The rate limit counts from here.
    operation.queuedAt = now;
    await tx.flush();
    return { created: true, operationId };
  });
  if (!start.created) return { operationId: start.operationId };

  try {
    const jobId = await enqueueAccountRecalculateJob({ correlationId: start.operationId }, deps);
    if (!jobId) throw new Error('The account.recalculate queue returned no job id');
    await backgroundOperationService.attachQueueJob(start.operationId, String(jobId));
  } catch (error) {
    await backgroundOperationService.markFailed(start.operationId, 'account.recalculate:enqueue-failed');
    throw error;
  }
  return { operationId: start.operationId };
}

/**
 * The job: claim the operation (or take it back after a dead worker), rebuild the account and
 * finish the operation with the result as its progress. Returns false when the operation was not
 * this job's to run. Throws when the rebuild fails, after its rollback; the worker decides whether
 * pg-boss retries.
 */
export async function runAccountRecalculation(em: EntityManager, correlationId: string, queueJobId: string, options: { now?: Date } = {}): Promise<boolean> {
  const bg = backgroundOperationService;
  if (!(await bg.claimJobStartOrResume(correlationId, queueJobId))) return false;
  const operation = await em.fork().findOneOrFail(BackgroundOperation, { correlationId, deletedAt: null }, { filters: false, populate: ['appuserKey', 'tenantKey'] });
  const accountKey = accountKeyOf(operation.resourceId);
  const appuserKey = operation.appuserKey?.appuserKey;
  const tenantKey = operation.tenantKey?.tenantKey;
  if (accountKey === null || appuserKey === undefined || tenantKey === undefined) throw new Error('account.recalculate operation has no scope');

  await bg.heartbeatJob(correlationId, queueJobId, { stage: 'account.recalculate:running' });
  const result = await recalculateAccount(em, accountKey, { now: options.now, visibleTo: { appuserKey, tenantKey } });
  if (!result) {
    await bg.finishJob(correlationId, queueJobId, { errorCode: 'account.recalculate:account-not-found', stage: 'account.recalculate:failed', status: BackgroundOperationStatus.FAILED });
    return true;
  }

  await bg.heartbeatJob(correlationId, queueJobId, { progress: { ...result }, stage: 'account.recalculate:complete' });
  if (!(await bg.finishJob(correlationId, queueJobId, { stage: 'account.recalculate:complete', status: BackgroundOperationStatus.SUCCEEDED }))) throw new Error('account.recalculate job could not finish');
  logger.info({ accountKey, correlationId, rowsChanged: result.rowsChanged, rowsScanned: result.rowsScanned }, 'Recalculated account balances');
  return true;
}

/** Whether the member is still in the account's household and may change the account (`account-access.ts`). */
async function isVisibleTo(em: EntityManager, account: Account, viewer: Omit<AccountRecalculationScope, 'accountKey'>): Promise<boolean> {
  if (account.tenantKey.tenantKey !== viewer.tenantKey) return false;
  if (!canWrite(await accountAccessOf(em, account.accountKey, viewer))) return false;
  const membership = await em.findOne(AppuserTenant, { appuserKey: { appuserKey: viewer.appuserKey }, deletedAt: null, recordActive: true, tenantKey: { tenantKey: viewer.tenantKey } }, { filters: false });
  return membership !== null;
}

/**
 * The account balance in its owner's currency, through the one rate resolver at the latest rate.
 * With no rate the stored figure stays: a balance is never replaced with nothing.
 */
interface RowSnapshot {
  appuserCurrencyBalance: null | number;
  appuserSettlementAmount: null | number;
  balance: null | number;
  fxStatus: null | string;
}

function changed(was: RowSnapshot, now: RowSnapshot): boolean {
  return moved(was.balance, now.balance)
    || moved(was.appuserCurrencyBalance, now.appuserCurrencyBalance)
    || moved(was.appuserSettlementAmount, now.appuserSettlementAmount)
    || was.fxStatus !== now.fxStatus;
}

function moved(was: null | number, now: null | number): boolean {
  if (was === null || now === null) return was !== now;
  return Math.abs(was - now) > BALANCE_TOLERANCE;
}

async function refreshOwnerCurrencyBalance(em: EntityManager, account: Account, now: Date): Promise<void> {
  const ownerCurrency = account.accountOwnerAppuserKey?.currencyKey;
  if (account.balance == null || !ownerCurrency) return;
  const converted = await convertWithStatus(em, account.balance, account.currencyKey, ownerCurrency, now, rateScope(account.tenantKey));
  if (converted.amount == null) return;
  account.appuserCurrencyBalance = converted.amount;
  account.fxStatus = converted.fxStatus;
}

function snapshot(row: Transaction): RowSnapshot {
  return {
    appuserCurrencyBalance: row.appuserCurrencyBalance ?? null,
    appuserSettlementAmount: row.appuserSettlementAmount ?? null,
    balance: row.balance ?? null,
    fxStatus: row.fxStatus ?? null,
  };
}
