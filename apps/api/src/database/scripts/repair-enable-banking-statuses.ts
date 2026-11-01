/**
 * #95 one-off repair: Enable Banking rows stored as BOOKED although the provider never booked them.
 *
 * Until #95 every Enable Banking row whose status was not `PEND` was stored as BOOKED, so pending,
 * held, scheduled, rejected and cancelled rows sit in the running balance and the totals, and a
 * pending row whose booked version arrived under another id left a booked duplicate behind. The
 * status was never stored, so this re-fetches each linked Enable Banking account from the provider
 * (read-only calls, the same ones a sync makes) and compares; the rules are in
 * `services/transaction/enable-banking-status-repair.service.ts`.
 *
 * Per changed row: status → PENDING or EXPIRED, running balance cleared (neither status is in the
 * chain), and a SYSTEM_EDIT audit row with the reason. Per account: one database transaction, then
 * the chain is rebuilt tail-anchored on the stored `account.balance`, which is never modified.
 * Hidden and soft-deleted rows are included: both are chain members.
 *
 * Read-only unless `--apply` is passed. Run the dry run first and review its per-account counts and
 * the rows listed for review (those are never changed). `--days=N` sets the re-fetch window
 * (default 90; banks may return less, and only the range actually returned is judged).
 *
 * Usage: cross-env NODE_ENV=<env> NODE_OPTIONS='--import=tsx' node src/database/scripts/repair-enable-banking-statuses.ts [--apply] [--days=90]
 *
 * Delete this script and `services/transaction/enable-banking-status-repair.service.ts` (with its
 * test) once it has run on every environment.
 */
import { pathToFileURL } from 'node:url';

import { type EntityManager, MikroORM } from '@mikro-orm/core';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import { EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType } from '@entity/TransactionAuditLog';
import { TransactionStatus } from '@entity/TransactionStatus';
import { type BankSyncTransaction, enableBankingTransactionIdFor, legacyEnableBankingTransactionIdFor } from '@service/account/account-initial-sync-transaction.service';
import { type AdaptedTransactionsResponse, classifyStatus, createEnableBankingSyncAdapter } from '@service/enable-banking/enable-banking-sync-adapter';
import { loadChainRows, recalculateChainFromAccountBalance } from '@service/transaction/balance-chain.service';
import { planStatusRepair, type ReportedRow, type StatusRepairPlan } from '@service/transaction/enable-banking-status-repair.service';
import { TransactionAuditService } from '@service/transaction/transaction-audit.service';
import logger from '@utils/logger';

import config from '../../mikro-orm.config';

const AUDIT_SOURCE = 'enable-banking-status-repair-95';
const DEFAULT_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AccountReport {
  accountKey: number;
  balanceRowsMoved: number;
  byChange: Record<string, number>;
  changed: number;
  coverageFrom: null | string;
  review: StatusRepairPlan['review'];
  /** Planned rows with no owner to audit against: reported, never written. */
  skipped: number;
  tenantKey: number;
}

/** Fetches one account's rows for a window. Injectable so the run can be exercised without a provider. */
export type FetchTransactions = (connection: EnableBankingConnection, accountId: string, window: { dateFrom: string; dateTo: string }) => Promise<AdaptedTransactionsResponse>;

const defaultFetch: FetchTransactions = (connection, accountId, window) => createEnableBankingSyncAdapter(connection).account(accountId).getTransactions(window);

export async function runStatusRepair(orm: MikroORM, options: { apply: boolean; days: number; fetchTransactions?: FetchTransactions; now?: Date }): Promise<AccountReport[]> {
  const fetchTransactions = options.fetchTransactions ?? defaultFetch;
  const now = options.now ?? new Date();
  const dateFrom = isoDate(new Date(now.getTime() - options.days * MS_PER_DAY));
  const dateTo = isoDate(now);

  const connections = await orm.em.fork().find(EnableBankingConnection, { deletedAt: undefined, status: EnableBankingConnectionStatus.LINKED }, { populate: ['enableBankingCredentialKey'] });
  const reports: AccountReport[] = [];
  for (const connection of connections) {
    const accounts = await orm.em.fork().find(Account, { deletedAt: undefined, enableBankingConnectionKey: connection });
    for (const account of accounts) {
      if (!account.accountId) continue;
      let response: AdaptedTransactionsResponse;
      try {
        response = await fetchTransactions(connection, account.accountId, { dateFrom, dateTo });
      } catch (error) {
        logger.warn({ accountKey: account.accountKey, error: error instanceof Error ? error.message : String(error) }, 'Re-fetch failed; account skipped');
        continue;
      }
      // One transaction per account, so a failure leaves every other account consistent.
      reports.push(await orm.em.fork().transactional((em) => repairAccount(em, account.accountKey, response, dateFrom, options.apply)));
    }
  }
  return reports;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
  const days = daysArg ? Number(daysArg.slice('--days='.length)) : DEFAULT_DAYS;
  if (!Number.isInteger(days) || days <= 0) throw new Error(`--days must be a positive integer, got ${daysArg}`);
  const orm = await MikroORM.init(config);
  try {
    const reports = await runStatusRepair(orm, { apply, days });
    const affected = reports.filter((report) => report.changed > 0 || report.review.length > 0 || report.skipped > 0);
    logger.info(
      {
        accountsAffected: affected.length,
        accountsChecked: reports.length,
        apply,
        balanceRowsMoved: affected.reduce((sum, report) => sum + report.balanceRowsMoved, 0),
        days,
        rowsForReview: affected.reduce((sum, report) => sum + report.review.length, 0),
        rowsToChange: affected.reduce((sum, report) => sum + report.changed, 0),
        tenantsAffected: new Set(affected.map((report) => report.tenantKey)).size,
      },
      apply ? '#95 Enable Banking status repair applied' : '#95 Enable Banking status repair dry run (nothing written)',
    );
    for (const report of affected) logger.info(report, 'account');
  } finally {
    await orm.close(true);
  }
}

/** Plans one account against its re-fetch and, when `apply`, writes the plan and rebuilds the chain. */
function isoDate(date: Date) { return date.toISOString().slice(0, 10); }

async function repairAccount(em: EntityManager, accountKey: number, response: AdaptedTransactionsResponse, requestedFrom: string, apply: boolean): Promise<AccountReport> {
  const account = await em.findOneOrFail(Account, { accountKey }, { populate: ['tenantKey'] });
  const accountId = account.accountId ?? String(account.accountKey);
  const report: AccountReport = { accountKey, balanceRowsMoved: 0, byChange: {}, changed: 0, coverageFrom: null, review: [], skipped: 0, tenantKey: account.tenantKey.tenantKey };

  const providerRows = [...(response.transactions?.booked ?? []), ...(response.transactions?.pending ?? []), ...(response.transactions?.voided ?? [])] as BankSyncTransaction[];
  // Nothing reported means nothing covered: no row can be judged missing.
  const reportedDates = providerRows.map((row) => row.bookingDate ?? row.valueDate ?? row.transactionDate).filter((date): date is string => Boolean(date)).sort();
  if (reportedDates.length === 0) return report;
  const oldestReported = reportedDates[0] ?? requestedFrom;
  const coverageFrom = new Date(`${oldestReported > requestedFrom ? oldestReported : requestedFrom}T00:00:00.000Z`);
  report.coverageFrom = isoDate(coverageFrom);
  // #96: a row is stored under its `entry_reference`, or under its `transaction_id` if it was stored
  // before #96 and not re-synced since. Legacy ids go first so a current id always wins a clash.
  const reportAs = (id: (accountId: string, row: BankSyncTransaction) => string) => providerRows.map((row) => ({ classification: classifyStatus(row.providerStatus), id: id(accountId, row), providerStatus: row.providerStatus }));
  const reported: ReportedRow[] = [...reportAs(legacyEnableBankingTransactionIdFor), ...reportAs(enableBankingTransactionIdFor)];

  // Counterparts can sit up to five days before the coverage start; stored rows are loaded from there.
  const stored = await em.find(
    Transaction,
    { accountKey: account, enableBankingTransactionId: { $ne: null }, transactionDate: { $gte: new Date(coverageFrom.getTime() - 6 * MS_PER_DAY) } },
    { filters: { [HIDDEN_FILTER]: false }, populate: ['settlementCurrencyKey', 'transactionStatusKey'] },
  );
  const plan = planStatusRepair({
    coverageFrom,
    reported,
    stored: stored.map((row) => ({
      createdAt: row.createdAt,
      currencyCode: row.settlementCurrencyKey?.code ?? '',
      enableBankingTransactionId: row.enableBankingTransactionId ?? '',
      hasUserEdits: row.editedSettlementAmount != null || Boolean(row.notes),
      settlementAmount: row.settlementAmount ?? 0,
      status: row.transactionStatusKey?.name ?? 'UNKNOWN',
      transactionDate: row.transactionDate ?? null,
      transactionKey: row.transactionKey,
    })),
  });
  report.review = plan.review;

  const rowsByKey = new Map(stored.map((row) => [row.transactionKey, row]));
  const statuses = new Map((await em.find(TransactionStatus, { name: { $in: ['EXPIRED', 'PENDING'] } })).map((status) => [status.name, status]));
  const chainKeys = new Set((await loadChainRows(em, account, { transactionDate: { $ne: null } })).map((row) => row.transactionKey));
  let chainTouched = false;

  for (const change of plan.changes) {
    const row = rowsByKey.get(change.transactionKey);
    const target = statuses.get(change.to);
    // A row without an owner cannot be audited; report it, never write it unaudited.
    if (!row || !target || !row.appuserKey || !row.tenantKey) {
      report.skipped += 1;
      continue;
    }
    const from = row.transactionStatusKey?.name ?? null;
    const label = `${from ?? 'UNKNOWN'}->${change.to}`;
    report.byChange[label] = (report.byChange[label] ?? 0) + 1;
    report.changed += 1;
    if (chainKeys.has(row.transactionKey)) chainTouched = true;
    if (!apply) continue;

    await TransactionAuditService.log(em, {
      accountKey,
      actorType: TransactionAuditActorType.SYSTEM,
      appuserKey: row.appuserKey.appuserKey,
      changes: { balance: { from: row.balance ?? null, to: null }, reason: { from: null, to: change.reason }, transactionStatusKey: { from, to: change.to } },
      // SYSTEM_EDIT, not SYSTEM_REMEDIATION: the event_type check constraint has never allowed the latter.
      eventType: TransactionAuditEventType.SYSTEM_EDIT,
      source: AUDIT_SOURCE,
      tenantKey: row.tenantKey.tenantKey,
      transactionKey: row.transactionKey,
    }, { flush: false });
    Object.assign(row as unknown as Record<string, unknown>, { appuserCurrencyBalance: null, balance: null, transactionStatusKey: target });
  }

  if (!apply || report.changed === 0) return report;
  await em.flush();
  if (!chainTouched) return report;
  // Tail anchor (no `anchor` argument): the provider's `account.balance` stays as stored and only
  // the running balances of the rows still in the chain are re-derived.
  const { changed } = await recalculateChainFromAccountBalance(em, account);
  report.balanceRowsMoved = changed;
  await em.flush();
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    logger.error({ error }, 'repair-enable-banking-statuses failed');
    process.exitCode = 1;
  });
}
