import { sql } from 'kysely';

import { DI } from '@app/database/di';
import { anyOf, sqlQuery } from '@app/database/sql';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Loan } from '@entity/Loan';
import { LoanAdjustment } from '@entity/LoanAdjustment';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import { Transaction } from '@entity/Transaction';
import { calculateOutstandingPrincipalWithAdjustments } from '@service/loan/loan-calculation.service';
import { excludeExpired, notExpiredTransactionSql } from '@service/transaction/transaction-status';
import { addMoney, sumMoney } from '@utils/money';

export interface NetWorthHistoryAccountLike {
  appuserCurrencyBalance?: null | number;
  createdAt?: Date;
  transactionDate?: Date | null;
  transactionKey: number;
}
export type NetWorthHistoryGranularity = 'monthly';
export interface NetWorthHistoryLoanLike {
  amount: number;
  effectiveDate?: Date | null;
}

export interface NetWorthHistoryPoint {
  accountsTotal: null | number;
  date: string;
  isComplete: boolean;
  loansTotal: null | number;
  portfoliosTotal: null | number;
  totalNetWorth: null | number;
}

export interface NetWorthHistoryPortfolioSnapshotLike {
  appuserCurrencyTotalValue?: null | number;
  createdAt?: Date;
  portfolioSnapshotKey: number;
  snapshotDate: Date;
}

export type NetWorthHistoryReadiness = 'empty' | 'insufficient_history' | 'ready';

export interface NetWorthHistorySummary {
  currencyCode: string;
  granularity: 'monthly';
  points: NetWorthHistoryPoint[];
  readiness: NetWorthHistoryReadiness;
}

export type NetWorthRowType = 'accounts' | 'loans' | 'portfolios';

export interface NetWorthSummary {
  assets: { accounts: number; portfolios: number };
  currencyCode: string;
  liabilities: { loans: number };
  rows: { balance: number; name: string; type: NetWorthRowType }[];
  totalNetWorth: number;
  unsupportedCurrencies: { loans: number; portfolios: number };
}

interface NetWorthInputRow {
  balance: number;
  name: string;
}

interface NetWorthSourceRow extends NetWorthInputRow {
  supportedCurrency?: boolean;
}

export class NetWorthService {
  async getNetWorth(appuser: Appuser): Promise<NetWorthSummary> {
    const currencyCode = await this.resolveCurrencyCode(appuser);
    const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(appuser);
    if (!appuserTenant) {
      throw new Error("User doesn't have AppuserTenant");
    }

    const [accounts, portfolioRows, loans] = await Promise.all([
      DI.em.find(
        Account,
        { deletedAt: undefined, tenantKey: appuserTenant.tenantKey },
        { orderBy: { createdAt: 'DESC' }, populate: ['currencyKey'] },
      ),
      this.getPortfolioRows(appuser, appuserTenant.tenantKey),
      DI.em.find(
        Loan,
        { deletedAt: undefined, includeInNetWorth: true, ownerAppuserKey: appuser, tenantKey: appuserTenant.tenantKey },
        { populate: ['currencyKey'] },
      ),
    ]);

    const loanRows = await Promise.all(
      loans.map(async (loan) => {
        const [repayments, adjustments] = await Promise.all([
          DI.em.find(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan }),
          DI.em.find(LoanAdjustment, { deletedAt: undefined, loanKey: loan }),
        ]);

        const outstandingPrincipal = calculateOutstandingPrincipalWithAdjustments({
          adjustments: adjustments.map((adj) => ({ amount: adj.amount, effectiveDate: adj.effectiveDate, type: adj.type })),
          openingPrincipalBalance: loan.openingPrincipalBalance,
          principalRepayments: repayments.map((repayment) => ({ amount: repayment.principalAmount, effectiveDate: repayment.paymentDate })),
        });

        return loan.currencyKey.code === currencyCode
          ? { balance: outstandingPrincipal, name: loan.name, supportedCurrency: true }
          : { balance: 0, name: loan.name, supportedCurrency: false };
      }),
    );

    const accountRows = accounts.map((account) => ({ balance: account.appuserCurrencyBalance ?? 0, name: account.accountName ?? 'Account' }));

    const unsupportedCurrencies = {
      loans: loanRows.filter((loan) => !loan.supportedCurrency).length,
      portfolios: portfolioRows.filter((portfolio) => !portfolio.supportedCurrency).length,
    };

    return buildNetWorthSummary({ accounts: accountRows, currencyCode, loans: loanRows, portfolios: portfolioRows, unsupportedCurrencies });
  }

  async getNetWorthHistory(appuser: Appuser, options?: { granularity?: NetWorthHistoryGranularity; months?: number; toDate?: Date }): Promise<NetWorthHistorySummary> {
    const currencyCode = await this.resolveCurrencyCode(appuser);
    const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(appuser);
    if (!appuserTenant) throw new Error("User doesn't have AppuserTenant");

    const months = clampHistoryMonths(options?.months);
    const now = new Date();
    const toDate = resolveHistoryToDate(options?.toDate, now);
    const basePoints = buildMonthlyHistoryPointDates(months, toDate);
    const today = startOfUtcDay(now);

    const [accounts, portfolios, loans] = await Promise.all([
      DI.em.find(Account, { deletedAt: undefined, tenantKey: appuserTenant.tenantKey }),
      DI.em.find(Portfolio, { deletedAt: undefined, tenantKey: appuserTenant.tenantKey }),
      DI.em.find(Loan, { deletedAt: undefined, includeInNetWorth: true, ownerAppuserKey: appuser, tenantKey: appuserTenant.tenantKey }, { populate: ['currencyKey'] }),
    ]);

    const pointDates = await buildHistoryPointDates({ accounts, appuser, basePoints, tenantKey: appuserTenant.tenantKey, toDate });

    const prefetchedBalances = await prefetchAccountBalancesByPoint(accounts, appuserTenant.tenantKey, pointDates);

    const pointSummaries = await Promise.all(pointDates.map(async (pointDate) => {
      const isCurrentPoint = isCurrentHistoryPoint(pointDate, today);
      const [accountsTotal, accountsComplete] = await calculateAccountsHistoryTotal(accounts, appuser, appuserTenant.tenantKey, pointDate, isCurrentPoint, prefetchedBalances);
      const [portfoliosTotal, portfoliosComplete] = await calculatePortfoliosHistoryTotal(portfolios, pointDate);
      const [loansTotal, loansComplete] = await calculateLoansHistoryTotal(loans, currencyCode, pointDate);
      const complete = accountsComplete && portfoliosComplete && loansComplete;
      const totalNetWorth = accountsTotal != null && portfoliosTotal != null && loansTotal != null ? accountsTotal + portfoliosTotal - loansTotal : null;

      return { accountsTotal, date: formatUtcDate(pointDate), isComplete: complete, loansTotal, portfoliosTotal, totalNetWorth };
    }));

    return { currencyCode, granularity: 'monthly', points: pointSummaries, readiness: calculateHistoryReadiness(pointSummaries) };
  }

  private async getPortfolioRows(_appuser: Appuser, tenantKey: AppuserTenant['tenantKey']) {
    const portfolios = await DI.em.find(
      Portfolio,
      { deletedAt: undefined, tenantKey },
      { populate: ['currencyKey'] },
    );

    // Raw SQL bypasses the tenant filter, so both the outer read and the MAX() subquery are
    // explicitly scoped to this tenant's own portfolios (unscoped, this would read EVERY tenant's
    // latest portfolio balance into request memory), and both skip soft-deleted snapshots (a deleted
    // snapshot could otherwise win MAX(snapshot_date) and become the reported balance).
    const portfolioKeys = portfolios.map((portfolio) => portfolio.portfolioKey);
    const latestSnapshots = portfolioKeys.length === 0 ? [] : await sqlQuery(DI.em)
      .selectFrom('portfolio_snapshot as ps')
      .innerJoin(
        sql<{ max_date: unknown; portfolio_key: unknown }>`(SELECT portfolio_key, MAX(snapshot_date) as max_date FROM portfolio_snapshot
             WHERE deleted_at IS NULL AND portfolio_key = ANY(${portfolioKeys}) GROUP BY portfolio_key)`.as('latest'),
        (join) => join.onRef('ps.portfolio_key', '=', 'latest.portfolio_key').onRef('ps.snapshot_date', '=', 'latest.max_date'),
      )
      .select(['ps.portfolio_key', sql<null | number | string>`ps.appuser_currency_total_value`.as('balance')])
      .where('ps.deleted_at', 'is', null)
      .where(anyOf('ps.portfolio_key', portfolioKeys))
      .execute();

    const balanceMap = new Map<number, number>();
    for (const row of latestSnapshots) {
      if (row.balance == null) continue;
      balanceMap.set(row.portfolio_key as number, Number(row.balance) || 0);
    }

    return portfolios.map((portfolio) => {
      const balance = balanceMap.get(portfolio.portfolioKey);
      return balance == null
        ? { balance: 0, name: portfolio.name, supportedCurrency: false }
        : { balance, name: portfolio.name, supportedCurrency: true };
    });
  }

  private async resolveCurrencyCode(appuser: Appuser): Promise<string> {
    await DI.em.populate(appuser, ['currencyKey']);
    const currencyCode = appuser.currencyKey.code;
    if (!currencyCode) throw new Error('Appuser currency relation did not resolve to a currency code');
    return currencyCode;
  }

}

export function buildMonthlyHistoryPointDates(months: number, toDate: Date): Date[] {
  const pointDates: Date[] = [];
  const current = startOfUtcDay(toDate);
  for (let offset = months - 1; offset >= 1; offset -= 1) {
    pointDates.push(endOfUtcMonth(addUtcMonths(current, -offset)));
  }
  pointDates.push(current);
  return pointDates;
}

export function buildNetWorthSummaryFromSourceRows(input: {
  accounts: NetWorthInputRow[];
  currencyCode: string;
  loans: (NetWorthSourceRow & { includeInNetWorth?: boolean })[];
  portfolios: NetWorthSourceRow[];
}): NetWorthSummary {
  const unsupportedCurrencies = {
    loans: input.loans.filter((loan) => loan.includeInNetWorth !== false && !(loan.supportedCurrency ?? true)).length,
    portfolios: input.portfolios.filter((portfolio) => !(portfolio.supportedCurrency ?? true)).length,
  };

  return buildNetWorthSummary({
    accounts: input.accounts,
    currencyCode: input.currencyCode,
    loans: input.loans
      .filter((loan) => loan.includeInNetWorth !== false && (loan.supportedCurrency ?? true))
      .map(({ supportedCurrency: _supportedCurrency, ...loan }) => loan),
    portfolios: input.portfolios.map(({ supportedCurrency: _supportedCurrency, ...portfolio }) => portfolio),
    unsupportedCurrencies,
  });
}

export function calculateHistoryReadiness(points: Pick<NetWorthHistoryPoint, 'totalNetWorth'>[]): NetWorthHistoryReadiness {
  const completeCount = points.filter((point) => point.totalNetWorth != null).length;
  if (completeCount >= 2) return 'ready';
  if (completeCount === 1) return 'insufficient_history';
  return 'empty';
}

export function clampHistoryMonths(months?: number): number {
  return clamp(months ?? 6, 2, 12);
}

export function isCurrentHistoryPoint(pointDate: Date, today: Date): boolean {
  return startOfUtcDay(pointDate).getTime() === startOfUtcDay(today).getTime();
}

export function mergeHistoryPointDates(basePoints: Date[], transactionDates: Date[]): Date[] {
  const pointMap = new Map<string, Date>();
  for (const date of [...basePoints, ...transactionDates]) pointMap.set(startOfUtcDay(date).toISOString(), startOfUtcDay(date));
  return [...pointMap.values()].sort((a, b) => a.getTime() - b.getTime());
}

export function resolveAccountHistoryTotal(accounts: NetWorthHistoryAccountLike[], pointDate: Date, isCurrentPoint = false): { complete: boolean; total: null | number } {
  let total = 0;
  for (const account of accounts) {
    if (account.createdAt != null && pointDate.getTime() < startOfUtcDay(account.createdAt).getTime()) continue;
    if (isCurrentPoint) {
      if (account.appuserCurrencyBalance == null) return { complete: false, total: null };
      total = addMoney(total, account.appuserCurrencyBalance);
      continue;
    }
    const eligible = account.transactionDate != null && account.transactionDate.getTime() < nextUtcDay(pointDate).getTime();
    if (!eligible) return { complete: false, total: null };
    if (account.appuserCurrencyBalance == null) return { complete: false, total: null };
    total = addMoney(total, account.appuserCurrencyBalance);
  }
  return { complete: true, total };
}

export function resolveHistoryToDate(requestedDate: Date | undefined, now: Date): Date {
  const today = startOfUtcDay(now);
  if (!requestedDate) return today;
  const requested = startOfUtcDay(requestedDate);
  return requested.getTime() > today.getTime() ? today : requested;
}

export function resolveLoanHistoryTotal(loans: { adjustments?: NetWorthHistoryLoanLike[]; currencyCode: string; openingBalanceDate: Date; openingPrincipalBalance: number; repayments?: NetWorthHistoryLoanLike[] }[], currencyCode: string, pointDate: Date): { complete: boolean; total: null | number } {
  let total = 0;
  for (const loan of loans) {
    if (loan.currencyCode !== currencyCode) return { complete: false, total: null };
    if (loan.openingBalanceDate.getTime() > pointDate.getTime()) continue;
    total = addMoney(total, calculateOutstandingPrincipalWithAdjustments({
      adjustments: (loan.adjustments ?? []).filter((item) => item.effectiveDate == null || item.effectiveDate.getTime() <= pointDate.getTime()).map((item) => ({ amount: item.amount, effectiveDate: item.effectiveDate, type: 'PRINCIPAL_INCREASE' })),
      openingPrincipalBalance: loan.openingPrincipalBalance,
      principalRepayments: (loan.repayments ?? []).filter((item) => item.effectiveDate == null || item.effectiveDate.getTime() <= pointDate.getTime()).map((item) => ({ amount: item.amount, effectiveDate: item.effectiveDate })),
    }));
  }
  return { complete: true, total };
}

export function resolvePortfolioHistoryTotal(portfolios: { snapshots: NetWorthHistoryPortfolioSnapshotLike[] }[], pointDate: Date): { complete: boolean; total: null | number } {
  let total = 0;
  for (const portfolio of portfolios) {
    const createdAt = portfolio.snapshots[0]?.createdAt;
    if (createdAt != null && pointDate.getTime() < startOfUtcDay(createdAt).getTime()) continue;
    const snapshot = portfolio.snapshots
      .filter((item) => item.snapshotDate.getTime() <= pointDate.getTime() && item.appuserCurrencyTotalValue != null)
      .sort((a, b) => b.snapshotDate.getTime() - a.snapshotDate.getTime() || b.portfolioSnapshotKey - a.portfolioSnapshotKey)[0];
    if (!snapshot) return { complete: false, total: null };
    total = addMoney(total, snapshot.appuserCurrencyTotalValue);
  }
  return { complete: true, total };
}

function addUtcMonths(date: Date, months: number) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)); }

async function buildHistoryPointDates(input: { accounts: Account[]; appuser: Appuser; basePoints: Date[]; tenantKey: AppuserTenant['tenantKey']; toDate: Date }): Promise<Date[]> {
  if (input.accounts.length === 0) return mergeHistoryPointDates(input.basePoints, []);

  // An EXPIRED row never moved money: a balance left on one is no balance, and its date is no point.
  const transactionDates = await DI.em.find(Transaction, excludeExpired({
    accountKey: { $in: input.accounts },
    appuserCurrencyBalance: { $ne: null },
    deletedAt: undefined,
    tenantKey: input.tenantKey,
    transactionDate: { $gte: startOfUtcDay(addUtcMonths(input.toDate, -5)), $lt: nextUtcDay(input.toDate) },
  }), { fields: ['transactionDate'] });
  return mergeHistoryPointDates(input.basePoints, transactionDates.map((transaction) => transaction.transactionDate).filter((date): date is Date => date != null));
}

function buildNetWorthSummary(input: {
  accounts: NetWorthInputRow[];
  currencyCode: string;
  loans: NetWorthInputRow[];
  portfolios: NetWorthInputRow[];
  unsupportedCurrencies?: { loans?: number; portfolios?: number };
}): NetWorthSummary {
  const assetsAccounts = sumMoney(input.accounts.map((account) => account.balance));
  const assetsPortfolios = sumMoney(input.portfolios.map((portfolio) => portfolio.balance));
  const liabilitiesLoans = sumMoney(input.loans.map((loan) => loan.balance));

  return {
    assets: { accounts: assetsAccounts, portfolios: assetsPortfolios },
    currencyCode: input.currencyCode,
    liabilities: { loans: liabilitiesLoans },
    rows: [
      ...input.accounts.map((account) => ({ ...account, type: 'accounts' as const })),
      ...input.portfolios.map((portfolio) => ({ ...portfolio, type: 'portfolios' as const })),
      ...input.loans.map((loan) => ({ ...loan, balance: -loan.balance, type: 'loans' as const })),
    ],
    totalNetWorth: assetsAccounts + assetsPortfolios - liabilitiesLoans,
    unsupportedCurrencies: {
      loans: input.unsupportedCurrencies?.loans ?? 0,
      portfolios: input.unsupportedCurrencies?.portfolios ?? 0,
    },
  };
}

/**
 * Per-(point, account) closing balance for every history point, in ONE query.
 *
 * `buildHistoryPointDates` expands the point list with every distinct transaction date in the
 * last six months, so an active user produces ~170 points. An unbounded, fully-hydrated
 * `find(Transaction)` per point — purely to pick the newest row per account — would be ~170
 * unbounded scans issued concurrently against a default pool of 10, hydrating millions of
 * objects into one identity map.
 *
 * A `LEFT JOIN LATERAL ... LIMIT 1` per (point, account) pair asks the database for exactly
 * the row the code actually wanted. It is served by `transaction_account_date_active_idx`
 * (`account_key, transaction_date DESC, transaction_key DESC` WHERE `deleted_at IS NULL`).
 *
 * Returns `Map<pointDateMs, Map<accountKey, balance>>`. A missing inner entry means the
 * account had no balance-carrying row at that point, which the caller treats as incomplete.
 */
/** `tenantKey` arrives as either a loaded entity reference or a bare number. */
async function calculateAccountsHistoryTotal(accounts: Account[], _appuser: Appuser, tenantKey: AppuserTenant['tenantKey'], pointDate: Date, isCurrentPoint: boolean, prefetched?: Map<number, Map<number, number>>): Promise<[null | number, boolean]> {
  const relevantAccounts = accounts.filter((account) => pointDate.getTime() >= startOfUtcDay(account.createdAt).getTime());
  if (relevantAccounts.length === 0) return [0, true];

  if (isCurrentPoint) {
    if (relevantAccounts.some((account) => account.appuserCurrencyBalance == null)) return [null, false];
    return [sumMoney(relevantAccounts.map((account) => account.appuserCurrencyBalance)), true];
  }
  // Prefer the single prefetched lateral-join result. The per-point fallback is kept for
  // callers (and tests) that invoke this directly without a prefetch.
  const prefetchedForPoint = prefetched?.get(pointDate.getTime());
  if (prefetchedForPoint) {
    const balances = relevantAccounts.map((account) => prefetchedForPoint.get(account.accountKey));
    if (balances.some((balance) => balance == null)) return [null, false];
    return [sumMoney(balances), true];
  }

  const transactions = await DI.em.find(Transaction, excludeExpired({ accountKey: { $in: relevantAccounts }, deletedAt: undefined, tenantKey, transactionDate: { $lt: nextUtcDay(pointDate) } }), { orderBy: { transactionDate: 'DESC', transactionKey: 'DESC' } });
  const byAccount = new Map<number, Transaction>();
  for (const transaction of transactions) {
    const accountKey = transaction.accountKey?.accountKey;
    if (accountKey == null || byAccount.has(accountKey) || transaction.appuserCurrencyBalance == null) continue;
    byAccount.set(accountKey, transaction);
  }
  if (byAccount.size !== relevantAccounts.length) return [null, false];
  return [sumMoney(relevantAccounts.map((account) => byAccount.get(account.accountKey)?.appuserCurrencyBalance)), true];
}

async function calculateLoansHistoryTotal(loans: Loan[], currencyCode: string, pointDate: Date): Promise<[null | number, boolean]> {
  let total = 0;
  for (const loan of loans) {
    if (loan.currencyKey.code !== currencyCode) return [null, false];
    if (loan.openingBalanceDate > pointDate) continue;
    const [adjustments, repayments] = await Promise.all([
      DI.em.find(LoanAdjustment, { deletedAt: undefined, effectiveDate: { $lt: nextUtcDay(pointDate) }, loanKey: loan }, { orderBy: { effectiveDate: 'ASC', loanAdjustmentKey: 'ASC' } }),
      DI.em.find(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan, paymentDate: { $lt: nextUtcDay(pointDate) } }, { orderBy: { loanRepaymentLinkKey: 'ASC', paymentDate: 'ASC' } }),
    ]);
    total = addMoney(total, calculateOutstandingPrincipalWithAdjustments({ adjustments: adjustments.map((adj) => ({ amount: adj.amount, effectiveDate: adj.effectiveDate, type: adj.type })), openingPrincipalBalance: loan.openingPrincipalBalance, principalRepayments: repayments.map((repayment) => ({ amount: repayment.principalAmount, effectiveDate: repayment.paymentDate })) }));
  }
  return [total, true];
}

async function calculatePortfoliosHistoryTotal(portfolios: Portfolio[], pointDate: Date): Promise<[null | number, boolean]> {
  const relevantPortfolios = portfolios.filter((portfolio) => pointDate.getTime() >= startOfUtcDay(portfolio.createdAt).getTime());
  if (relevantPortfolios.length === 0) return [0, true];

  const snapshots = await DI.em.find(PortfolioSnapshot, { deletedAt: undefined, portfolioKey: { $in: relevantPortfolios }, snapshotDate: { $lt: nextUtcDay(pointDate) } }, { orderBy: { portfolioSnapshotKey: 'DESC', snapshotDate: 'DESC' } });
  const latestByPortfolio = new Map<number, PortfolioSnapshot>();
  for (const snapshot of snapshots) {
    const portfolioKey = snapshot.portfolioKey.portfolioKey;
    const existing = latestByPortfolio.get(portfolioKey);
    if (snapshot.appuserCurrencyTotalValue == null) continue;
    if (existing && comparePortfolioSnapshotsByAsOfDate(existing, snapshot) >= 0) continue;
    latestByPortfolio.set(portfolioKey, snapshot);
  }
  if (latestByPortfolio.size !== relevantPortfolios.length) return [null, false];
  let total = 0;
  for (const portfolio of relevantPortfolios) {
    const snapshot = latestByPortfolio.get(portfolio.portfolioKey);
    if (snapshot?.appuserCurrencyTotalValue == null) return [null, false];
    total = addMoney(total, snapshot.appuserCurrencyTotalValue);
  }
  return [total, true];
}
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function comparePortfolioSnapshotsByAsOfDate(a: PortfolioSnapshot, b: PortfolioSnapshot) {
  return a.snapshotDate.getTime() - b.snapshotDate.getTime() || a.portfolioSnapshotKey - b.portfolioSnapshotKey;
}

function endOfUtcMonth(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)); }

function formatUtcDate(date: Date) { return date.toISOString().slice(0, 10); }
function nextUtcDay(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)); }

async function prefetchAccountBalancesByPoint(
  accounts: Account[],
  tenantKey: AppuserTenant['tenantKey'],
  pointDates: Date[],
): Promise<Map<number, Map<number, number>>> {
  const byPoint = new Map<number, Map<number, number>>();
  for (const pointDate of pointDates) byPoint.set(pointDate.getTime(), new Map());
  if (accounts.length === 0 || pointDates.length === 0) return byPoint;

  const accountKeys = accounts.map((account) => account.accountKey);
  const pointIsoDates = pointDates.map((pointDate) => nextUtcDay(pointDate).toISOString());

  const { rows } = await sql<{ account_key: number; balance: null | number | string; point_date: Date | string }>`
    select p.point_date as point_date, a.account_key as account_key, latest.appuser_currency_balance as balance
    from unnest(${pointIsoDates}::timestamptz[]) as p(point_date)
    cross join unnest(${accountKeys}::int[]) as a(account_key)
    left join lateral (
         select t."appuser_currency_balance"
         from "transaction" t
         where t."account_key" = a.account_key
           and t."tenant_key" = ${resolveTenantKeyNumber(tenantKey)}
           and t."deleted_at" is null
           and t."appuser_currency_balance" is not null
           and ${sql.raw(notExpiredTransactionSql('t'))}
           and t."transaction_date" < p.point_date
         order by t."transaction_date" desc, t."transaction_key" desc
         limit 1
       ) latest on true`.execute(sqlQuery(DI.em));

  // `p.point_date` is the exclusive upper bound (next UTC day); map it back to the point.
  const boundToPoint = new Map<number, number>();
  for (const pointDate of pointDates) boundToPoint.set(nextUtcDay(pointDate).getTime(), pointDate.getTime());

  for (const row of rows) {
    if (row.balance == null) continue;
    const boundMs = new Date(row.point_date).getTime();
    const pointMs = boundToPoint.get(boundMs);
    if (pointMs == null) continue;
    byPoint.get(pointMs)?.set(row.account_key, Number(row.balance));
  }
  return byPoint;
}

function resolveTenantKeyNumber(tenantKey: AppuserTenant['tenantKey']): number {
  return typeof tenantKey === 'number' ? tenantKey : (tenantKey as unknown as { tenantKey: number }).tenantKey;
}

function startOfUtcDay(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }

export default new NetWorthService();
