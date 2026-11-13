import { sql } from 'kysely';

import { DI } from '@app/database/di';
import { sqlQuery } from '@app/database/sql';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Loan } from '@entity/Loan';
import { LoanAdjustment } from '@entity/LoanAdjustment';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import { Transaction } from '@entity/Transaction';
import { ACCOUNT_BALANCE_POPULATE, accountBalanceIn, loadAccountRates } from '@service/currency/account-balance';
import { type CurrencyPair, loadRateTable, rateScope, type RateTable } from '@service/currency/exchange-rate';
import { basisPointsMatching, loadAccountOwnership, memberPartOf, type OwnershipParts, ownershipPartsOf, WHOLE_SHARE } from '@service/household/account-ownership';
import { accountAttributionOf, loadActiveMembers, matchesMemberFilter, type MemberFilter } from '@service/household/member-attribution';
import { calculateOutstandingPrincipalWithAdjustments } from '@service/loan/loan-calculation.service';
import { assetValueFor, currentAssetValueFor, loadAssetRates, type LoadedManualAsset, loadVisibleManualAssets, manualAssetRatePairs } from '@service/manual-asset/manual-asset.service';
import { portfolioCountedInAccount, type PortfolioLinkFields, shouldSuggestPortfolioLink } from '@service/portfolio/portfolio-account-link';
import { type PortfolioSnapshotValue, snapshotInViewerCurrency, historyRatePairs as snapshotRatePairs, storedSnapshotValue } from '@service/portfolio/portfolio-history-currency';
import portfolioHoldingsService from '@service/portfolio/portfolio-holdings.service';
import { excludeExpired, notExpiredTransactionSql } from '@service/transaction/transaction-status';
import { addMoney, Money, subtractMoney, sumMoney } from '@utils/money';

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
  /** Manually valued assets, each at its latest valuation on or before the date. */
  manualAssetsTotal: null | number;
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

export type NetWorthRowType = 'accounts' | 'loans' | 'manualAssets' | 'portfolios';

export interface NetWorthSummary {
  /**
   * `portfolios` holds only the portfolios that add to the total (see `rows[].countedInAccountId`).
   * `manualAssets` is the manually valued assets (homes, vehicles) at their value today.
   */
  assets: { accounts: number; manualAssets: number; portfolios: number };
  currencyCode: string;
  /** False when any row was left out because it could not be valued in `currencyCode`. */
  isComplete: boolean;
  liabilities: { loans: number };
  /**
   * `id` is the account, portfolio, manual asset or loan key, so clients can match a row to its record. A
   * portfolio row with `countedInAccountId` is already inside that account's balance: it is shown
   * as a breakdown and adds nothing to the totals.
   */
  rows: { balance: number; countedInAccountId?: number; id?: number; name: string; sharePercent?: number; type: NetWorthRowType }[];
  /** The viewer can see an investment account no portfolio is linked to, and the household has an unlinked portfolio: ask whether they hold the same money. */
  suggestPortfolioLink: boolean;
  totalNetWorth: number;
  /**
   * The currencies of the accounts, loans and manual assets left out of the totals for want of an
   * exchange rate, sorted, so a client can name them. A partly valued portfolio has no single
   * currency to name.
   */
  unconvertedCurrencies: string[];
  /**
   * Rows left out of the totals because they could not be valued in `currencyCode`. An account or a
   * manual asset counts here when it cannot be converted: it adds nothing, and the summary is incomplete.
   */
  unsupportedCurrencies: { accounts: number; loans: number; manualAssets: number; portfolios: number };
}

interface NetWorthInputRow {
  balance: number;
  /** Portfolios only: the counted account whose balance already includes this portfolio. */
  countedInAccountId?: number;
  id?: number;
  name: string;
  /** Accounts only, under a member filter: the percentage of the account counted, when it is not all of it. */
  sharePercent?: number;
}

interface NetWorthSourceRow extends NetWorthInputRow {
  supportedCurrency?: boolean;
}

/** Which members' net worth to count (`member-attribution.ts`); absent: the household's. */
export interface NetWorthOptions {
  members?: MemberFilter;
}

type OwnerRef = null | undefined | { appuserKey: number };

/**
 * The part of the household's net worth a member filter keeps, from what the viewer already sees:
 * an account by its ownership shares when it has them, else by its attribution (its owner, or Shared
 * when joint; `account-ownership.ts`), a portfolio and a manual asset by their owner, and the
 * viewer's loans only when the viewer is one of the members asked for (another member's loans are
 * never the viewer's to see). An owner who has left the household counts as Shared. With no filter,
 * everything, so the household's figures do not depend on the shares at all.
 */
interface MemberSelection {
  /** The basis points of the account the filter keeps: 0 leaves it out, {@link WHOLE_SHARE} keeps all of it. */
  basisPoints: (account: Account) => number;
  loans: boolean;
  /** Whether the filter keeps what this member owns outright (a portfolio, a manual asset). */
  owner: (owner: OwnerRef) => boolean;
  /** The part of the account's value, in the viewer's currency, the filter keeps. */
  part: (account: Account, value: Money) => Money;
}

export class NetWorthService {
  async getNetWorth(appuser: Appuser, options: NetWorthOptions = {}): Promise<NetWorthSummary> {
    const currencyCode = await this.resolveCurrencyCode(appuser);
    const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(appuser);
    if (!appuserTenant) {
      throw new Error("User doesn't have AppuserTenant");
    }
    const [allAccounts, allManualAssets, allLoans] = await Promise.all([
      DI.em.find(
        Account,
        { deletedAt: undefined, tenantKey: appuserTenant.tenantKey },
        { orderBy: { createdAt: 'DESC' }, populate: [...ACCOUNT_BALANCE_POPULATE, 'accountTypeKey'] },
      ),
      // Carries the tenant and the privacy rule itself: the other member's private asset is never loaded.
      loadVisibleManualAssets(DI.em, { appuserKey: appuser.appuserKey, tenantKey: resolveTenantKeyNumber(appuserTenant.tenantKey) }),
      DI.em.find(
        Loan,
        { deletedAt: undefined, includeInNetWorth: true, ownerAppuserKey: appuser, tenantKey: appuserTenant.tenantKey },
        { populate: ['currencyKey'] },
      ),
    ]);
    const selection = await memberSelection(resolveTenantKeyNumber(appuserTenant.tenantKey), appuser.appuserKey, options.members, allAccounts);
    const manualAssets = allManualAssets.filter(({ asset }) => selection.owner(asset.ownerAppuserKey as OwnerRef));
    const loans = selection.loans ? allLoans : [];
    const portfolioRows = await this.getPortfolioRows(appuser, appuserTenant.tenantKey, selection.owner);

    const asOf = new Date();
    const loanRows = await Promise.all(
      loans.map(async (loan) => {
        const [repayments, adjustments] = await Promise.all([
          DI.em.find(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan, paymentDate: { $lte: asOf } }),
          DI.em.find(LoanAdjustment, { deletedAt: undefined, effectiveDate: { $lte: asOf }, loanKey: loan }),
        ]);

        const outstandingPrincipal = calculateOutstandingPrincipalWithAdjustments({
          adjustments: adjustments.map((adj) => ({ amount: adj.amount, effectiveDate: adj.effectiveDate, type: adj.type })),
          asOfDate: asOf,
          openingPrincipalBalance: loan.openingPrincipalBalance,
          principalRepayments: repayments.map((repayment) => ({ amount: repayment.principalAmount, effectiveDate: repayment.paymentDate })),
        });

        return loan.currencyKey.code === currencyCode
          ? { balance: outstandingPrincipal, id: loan.loanKey, name: loan.name, supportedCurrency: true }
          : { balance: 0, id: loan.loanKey, name: loan.name, supportedCurrency: false };
      }),
    );

    // Each member keeps their own currency, and an account's stored user-currency balance is in its
    // owner's. Convert every account into the viewer's currency; one that cannot be converted is
    // left out and counted, never added in a foreign currency. A member's figure takes their part of
    // each account they hold a share of, split from the converted value so the parts add up exactly.
    const rates = await loadAccountRates(DI.em, allAccounts, currencyCode, asOf, rateScope(resolveTenantKeyNumber(appuserTenant.tenantKey)));
    const accountRows: NetWorthInputRow[] = [];
    let unconvertedAccounts = 0;
    const unconvertedCurrencies = new Set<string>();
    // The household's counted accounts, whoever's figure this is: a portfolio inside one adds nothing
    // to anyone, since the account's holders already carry it in their parts.
    const countedAccountKeys = new Set<number>();
    for (const account of allAccounts) {
      const value = accountBalanceIn(account, currencyCode, rates, asOf);
      if (value) countedAccountKeys.add(account.accountKey);
      const kept = selection.basisPoints(account);
      if (kept === 0) continue;
      if (!value) {
        unconvertedAccounts += 1;
        if (account.currencyKey.code) unconvertedCurrencies.add(account.currencyKey.code);
        continue;
      }
      const balance = Money.toNumber(selection.part(account, Money.of(Money.toNumber(value), currencyCode)));
      accountRows.push({ balance, id: account.accountKey, name: account.accountName ?? 'Account', ...(kept < WHOLE_SHARE ? { sharePercent: kept / 100 } : {}) });
    }

    // A portfolio inside a counted account's balance is shown but not added (`portfolio-account-link.ts`).
    const portfolios: NetWorthSourceRow[] = portfolioRows.map(({ link, ...row }) => {
      const countedInAccountId = portfolioCountedInAccount(link, countedAccountKeys);
      return countedInAccountId == null ? row : { ...row, countedInAccountId };
    });

    // A manual asset counts at its value today, converted from its own currency at the latest
    // rate. One with no rate is left out and its currency reported, never added at face value.
    const assetRates = await loadAssetRates(DI.em, manualAssets, currencyCode, { from: asOf, to: asOf }, rateScope(resolveTenantKeyNumber(appuserTenant.tenantKey)));
    const manualAssetRows: NetWorthInputRow[] = [];
    const unconvertedAssetCurrencies: string[] = [];
    for (const loaded of manualAssets) {
      const value = currentAssetValueFor(loaded, currencyCode, assetRates, asOf);
      if (!value) continue;
      if (value.valueInViewerCurrency == null) {
        unconvertedAssetCurrencies.push(value.currencyCode);
        continue;
      }
      manualAssetRows.push({ balance: value.valueInViewerCurrency, id: loaded.asset.manualAssetKey, name: loaded.asset.name });
    }

    const unsupportedCurrencies = {
      accounts: unconvertedAccounts,
      loans: loanRows.filter((loan) => !loan.supportedCurrency).length,
      manualAssets: unconvertedAssetCurrencies.length,
      portfolios: portfolios.filter((portfolio) => !portfolio.supportedCurrency && portfolio.countedInAccountId == null).length,
    };

    for (const loan of loans) if (loan.currencyKey.code && loan.currencyKey.code !== currencyCode) unconvertedCurrencies.add(loan.currencyKey.code);

    return {
      ...buildNetWorthSummary({ accounts: accountRows, currencyCode, loans: loanRows, manualAssets: manualAssetRows, portfolios, unconvertedCurrencies: [...unconvertedCurrencies, ...unconvertedAssetCurrencies], unsupportedCurrencies }),
      suggestPortfolioLink: shouldSuggestPortfolioLink(allAccounts, portfolioRows.map((row) => row.link)),
    };
  }

  async getNetWorthHistory(appuser: Appuser, options?: NetWorthOptions & { granularity?: NetWorthHistoryGranularity; months?: number; toDate?: Date }): Promise<NetWorthHistorySummary> {
    const currencyCode = await this.resolveCurrencyCode(appuser);
    const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(appuser);
    if (!appuserTenant) throw new Error("User doesn't have AppuserTenant");
    const months = clampHistoryMonths(options?.months);
    const now = new Date();
    const toDate = resolveHistoryToDate(options?.toDate, now);
    const basePoints = buildMonthlyHistoryPointDates(months, toDate);
    const today = startOfUtcDay(now);

    const [allAccounts, allPortfolios, allManualAssets, allLoans] = await Promise.all([
      DI.em.find(Account, { deletedAt: undefined, tenantKey: appuserTenant.tenantKey }, { populate: ACCOUNT_BALANCE_POPULATE }),
      DI.em.find(Portfolio, { deletedAt: undefined, tenantKey: appuserTenant.tenantKey }, { populate: ['portfolioOwnerAppuserKey.currencyKey'] }),
      loadVisibleManualAssets(DI.em, { appuserKey: appuser.appuserKey, tenantKey: resolveTenantKeyNumber(appuserTenant.tenantKey) }),
      DI.em.find(Loan, { deletedAt: undefined, includeInNetWorth: true, ownerAppuserKey: appuser, tenantKey: appuserTenant.tenantKey }, { populate: ['currencyKey'] }),
    ]);
    const selection = await memberSelection(resolveTenantKeyNumber(appuserTenant.tenantKey), appuser.appuserKey, options?.members, allAccounts);
    const accounts = allAccounts.filter((account) => selection.basisPoints(account) > 0);
    const portfolios = allPortfolios.filter((portfolio) => selection.owner(portfolio.portfolioOwnerAppuserKey));
    const manualAssets = allManualAssets.filter(({ asset }) => selection.owner(asset.ownerAppuserKey as OwnerRef));
    const loans = selection.loans ? allLoans : [];

    const pointDates = await buildHistoryPointDates({ accounts, appuser, basePoints, manualAssets, tenantKey: appuserTenant.tenantKey, toDate });

    const prefetchedBalances = await prefetchAccountBalancesByPoint(accounts, appuserTenant.tenantKey, pointDates);
    const snapshotsByPoint = await loadPortfolioSnapshotsByPoint(portfolios, pointDates.filter((pointDate) => !isCurrentHistoryPoint(pointDate, today)));
    // A running balance is in the account owner's currency and an opening balance in the
    // account's own; each is converted into the viewer's at the point's rate. A portfolio
    // snapshot is in its owner's currency, converted at the rate at the end of its own day.
    const snapshots = [...snapshotsByPoint.values()].flatMap((byPortfolio) => [...byPortfolio.values()]);
    const ratesFrom = minDate([pointDates[0] ?? toDate, ...snapshots.map((snapshot) => new Date(`${snapshot.date}T00:00:00.000Z`))]);
    const rates = await loadRateTable(DI.em, [...historyRatePairs(accounts, currencyCode), ...snapshotRatePairs(snapshots, currencyCode), ...manualAssetRatePairs(manualAssets, currencyCode)], { from: ratesFrom, to: nextUtcDay(toDate) }, rateScope(resolveTenantKeyNumber(appuserTenant.tenantKey)));
    const toViewer = historyBalanceConverter(currencyCode, rates);

    // Today's point is the figure Home shows: `getNetWorth` values portfolios live, while
    // snapshots lag (yesterday's misses today's trades). Earlier points stay on snapshots.
    const currentSummary = pointDates.some((pointDate) => isCurrentHistoryPoint(pointDate, today))
      ? await this.getNetWorth(appuser, { members: options?.members })
      : undefined;

    const pointSummaries = await Promise.all(pointDates.map(async (pointDate) => {
      const isCurrentPoint = isCurrentHistoryPoint(pointDate, today);
      const [accountsTotal, accountsComplete] = await calculateAccountsHistoryTotal(accounts, toViewer, appuserTenant.tenantKey, pointDate, isCurrentPoint, prefetchedBalances, (account, value) => Money.toNumber(selection.part(account, Money.of(value, currencyCode))));
      if (isCurrentPoint && currentSummary) {
        return currentNetWorthHistoryPoint(currentSummary, formatUtcDate(pointDate), accountsComplete);
      }
      // Counted against the household's accounts, as `getNetWorth` does: a portfolio inside one is in its holders' parts.
      const [portfoliosTotal, portfoliosComplete] = calculatePortfoliosHistoryTotal(portfolios, toViewer, pointDate, snapshotsByPoint.get(pointDate.getTime()) ?? new Map(), accountsCountedAt(allAccounts, pointDate));
      const [manualAssetsTotal, manualAssetsComplete] = calculateManualAssetsHistoryTotal(manualAssets, currencyCode, rates, pointDate);
      const [loansTotal, loansComplete] = await calculateLoansHistoryTotal(loans, currencyCode, pointDate);
      const complete = accountsComplete && portfoliosComplete && manualAssetsComplete && loansComplete;
      const totalNetWorth = accountsTotal != null && portfoliosTotal != null && manualAssetsTotal != null && loansTotal != null
        ? subtractMoney(sumMoney([accountsTotal, portfoliosTotal, manualAssetsTotal]), loansTotal)
        : null;

      return { accountsTotal, date: formatUtcDate(pointDate), isComplete: complete, loansTotal, manualAssetsTotal, portfoliosTotal, totalNetWorth };
    }));

    return { currencyCode, granularity: 'monthly', points: pointSummaries, readiness: calculateHistoryReadiness(pointSummaries) };
  }

  private async getPortfolioRows(appuser: Appuser, tenantKey: AppuserTenant['tenantKey'], keepOwner: (owner: OwnerRef) => boolean) {
    const portfolios = (await DI.em.find(
      Portfolio,
      { deletedAt: undefined, tenantKey },
      { populate: ['currencyKey'] },
    )).filter((portfolio) => keepOwner(portfolio.portfolioOwnerAppuserKey));

    // Each portfolio at its current value, the figure the portfolio screens show
    // (`valuePortfolioHoldings`), not the latest daily snapshot, which misses today's trades.
    // The holdings reads carry the explicit tenant predicate their raw SQL needs.
    const values = await portfolioHoldingsService.getPortfolioValues(
      appuser,
      portfolios.map((portfolio) => portfolio.portfolioKey),
      resolveTenantKeyNumber(tenantKey),
    );

    // A holding with no price or exchange rate leaves the value partial: it still counts what
    // could be valued, and `supportedCurrency: false` reports the total as incomplete.
    return portfolios.map((portfolio) => {
      const value = values.get(portfolio.portfolioKey) ?? { isComplete: true, value: 0 };
      const link: PortfolioLinkFields = { accountBalanceMode: portfolio.accountBalanceMode, linkedAccountKey: portfolio.linkedAccountKey };
      return { balance: value.value, id: portfolio.portfolioKey, link, name: portfolio.name, supportedCurrency: value.isComplete };
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
  /** Manually valued assets, already in `currencyCode`. */
  manualAssets?: NetWorthInputRow[];
  portfolios: NetWorthSourceRow[];
}): Omit<NetWorthSummary, 'suggestPortfolioLink'> {
  const unsupportedCurrencies = {
    accounts: 0,
    loans: input.loans.filter((loan) => loan.includeInNetWorth !== false && !(loan.supportedCurrency ?? true)).length,
    manualAssets: 0,
    portfolios: input.portfolios.filter((portfolio) => !(portfolio.supportedCurrency ?? true)).length,
  };

  return buildNetWorthSummary({
    accounts: input.accounts,
    currencyCode: input.currencyCode,
    loans: input.loans
      .filter((loan) => loan.includeInNetWorth !== false && (loan.supportedCurrency ?? true))
      .map(({ supportedCurrency: _supportedCurrency, ...loan }) => loan),
    manualAssets: input.manualAssets,
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

async function memberSelection(tenantKey: number, viewerAppuserKey: number, members: MemberFilter | undefined, accounts: readonly Account[]): Promise<MemberSelection> {
  if (!members) return { basisPoints: () => WHOLE_SHARE, loans: true, owner: () => true, part: (_account, value) => value };
  const [activeMembers, ownership] = await Promise.all([
    loadActiveMembers(DI.em, tenantKey),
    loadAccountOwnership(DI.em, tenantKey, accounts.map((account) => account.accountKey)),
  ]);
  const active = new Set(activeMembers.keys());
  const parts = new Map<number, OwnershipParts>();
  const partsOf = (account: Account): OwnershipParts => {
    let found = parts.get(account.accountKey);
    if (!found) {
      found = ownershipPartsOf({ isJoint: account.isJoint, ownerAppuserKey: (account.accountOwnerAppuserKey as OwnerRef)?.appuserKey }, ownership.get(account.accountKey) ?? [], active);
      parts.set(account.accountKey, found);
    }
    return found;
  };
  return {
    basisPoints: (account) => basisPointsMatching(partsOf(account), members),
    loans: members.appuserKeys.includes(viewerAppuserKey),
    owner: (owner) => matchesMemberFilter(accountAttributionOf({ isJoint: false, ownerAppuserKey: owner?.appuserKey }, active), members),
    part: (account, value) => memberPartOf(value, partsOf(account), members),
  };
}

/**
 * The history point for today, taken from the live net worth summary so the trend's latest
 * value and Home agree to the cent. Totals are always reported (as Home reports them); a
 * missing account balance, an unpriced holding, a manual asset with no exchange rate or a loan in
 * another currency marks the point incomplete.
 */
export function currentNetWorthHistoryPoint(summary: NetWorthSummary, date: string, accountsComplete = true): NetWorthHistoryPoint {
  return {
    accountsTotal: summary.assets.accounts,
    date,
    isComplete: accountsComplete
      && summary.unsupportedCurrencies.accounts === 0
      && summary.unsupportedCurrencies.loans === 0
      && summary.unsupportedCurrencies.manualAssets === 0
      && summary.unsupportedCurrencies.portfolios === 0,
    loansTotal: summary.liabilities.loans,
    manualAssetsTotal: summary.assets.manualAssets,
    portfoliosTotal: summary.assets.portfolios,
    totalNetWorth: summary.totalNetWorth,
  };
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
  const asOfDate = new Date(nextUtcDay(pointDate).getTime() - 1);
  for (const loan of loans) {
    if (loan.currencyCode !== currencyCode) return { complete: false, total: null };
    if (loan.openingBalanceDate.getTime() > pointDate.getTime()) continue;
    total = addMoney(total, calculateOutstandingPrincipalWithAdjustments({
      adjustments: (loan.adjustments ?? []).filter((item) => item.effectiveDate == null || item.effectiveDate.getTime() <= asOfDate.getTime()).map((item) => ({ amount: item.amount, effectiveDate: item.effectiveDate, type: 'PRINCIPAL_INCREASE' })),
      asOfDate,
      openingPrincipalBalance: loan.openingPrincipalBalance,
      principalRepayments: (loan.repayments ?? []).filter((item) => item.effectiveDate == null || item.effectiveDate.getTime() <= asOfDate.getTime()).map((item) => ({ amount: item.amount, effectiveDate: item.effectiveDate })),
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

async function buildHistoryPointDates(input: { accounts: Account[]; appuser: Appuser; basePoints: Date[]; manualAssets: LoadedManualAsset[]; tenantKey: AppuserTenant['tenantKey']; toDate: Date }): Promise<Date[]> {
  const windowStart = startOfUtcDay(addUtcMonths(input.toDate, -5));
  const windowEnd = nextUtcDay(input.toDate);
  // A valuation moves net worth on its own day, so that day is a point, like a transaction's.
  const valuationDates = input.manualAssets
    .flatMap((loaded) => loaded.valuations.map((valuation) => new Date(valuation.valuationDate)))
    .filter((date) => date.getTime() >= windowStart.getTime() && date.getTime() < windowEnd.getTime());
  if (input.accounts.length === 0) return mergeHistoryPointDates(input.basePoints, valuationDates);

  // An EXPIRED row never moved money: a balance left on one is no balance, and its date is no point.
  const transactionDates = await DI.em.find(Transaction, excludeExpired({
    accountKey: { $in: input.accounts },
    appuserCurrencyBalance: { $ne: null },
    deletedAt: undefined,
    tenantKey: input.tenantKey,
    transactionDate: { $gte: windowStart, $lt: windowEnd },
  }), { fields: ['transactionDate'] });
  return mergeHistoryPointDates(input.basePoints, [...valuationDates, ...transactionDates.map((transaction) => transaction.transactionDate).filter((date): date is Date => date != null)]);
}

function buildNetWorthSummary(input: {
  accounts: NetWorthInputRow[];
  currencyCode: string;
  loans: NetWorthInputRow[];
  manualAssets?: NetWorthInputRow[];
  portfolios: NetWorthInputRow[];
  unconvertedCurrencies?: string[];
  unsupportedCurrencies?: { accounts?: number; loans?: number; manualAssets?: number; portfolios?: number };
}): Omit<NetWorthSummary, 'suggestPortfolioLink'> {
  // Every row reaching here is already in the viewer's currency.
  const inViewerCurrency = (rows: NetWorthInputRow[]) => Money.toNumber(Money.sum(rows.map((row) => Money.of(row.balance, input.currencyCode)), input.currencyCode));
  const assetsAccounts = inViewerCurrency(input.accounts);
  const assetsPortfolios = inViewerCurrency(input.portfolios.filter((portfolio) => portfolio.countedInAccountId == null));
  const manualAssets = input.manualAssets ?? [];
  const assetsManual = inViewerCurrency(manualAssets);
  const liabilitiesLoans = inViewerCurrency(input.loans);

  const unsupportedCurrencies = {
    accounts: input.unsupportedCurrencies?.accounts ?? 0,
    loans: input.unsupportedCurrencies?.loans ?? 0,
    manualAssets: input.unsupportedCurrencies?.manualAssets ?? 0,
    portfolios: input.unsupportedCurrencies?.portfolios ?? 0,
  };

  return {
    assets: { accounts: assetsAccounts, manualAssets: assetsManual, portfolios: assetsPortfolios },
    currencyCode: input.currencyCode,
    isComplete: unsupportedCurrencies.accounts === 0 && unsupportedCurrencies.loans === 0 && unsupportedCurrencies.manualAssets === 0 && unsupportedCurrencies.portfolios === 0,
    liabilities: { loans: liabilitiesLoans },
    rows: [
      ...input.accounts.map((account) => ({ ...account, type: 'accounts' as const })),
      ...input.portfolios.map((portfolio) => ({ ...portfolio, type: 'portfolios' as const })),
      ...manualAssets.map((asset) => ({ ...asset, type: 'manualAssets' as const })),
      ...input.loans.map((loan) => ({ ...loan, balance: -loan.balance, type: 'loans' as const })),
    ],
    totalNetWorth: subtractMoney(sumMoney([assetsAccounts, assetsPortfolios, assetsManual]), liabilitiesLoans),
    unconvertedCurrencies: [...new Set(input.unconvertedCurrencies ?? [])].sort(),
    unsupportedCurrencies,
  };
}

/** The accounts a history point counts: those that existed by its day. */
function accountsCountedAt(accounts: Account[], pointDate: Date): Set<number> {
  return new Set(relevantAccountsAt(accounts, pointDate).map((account) => account.accountKey));
}

/**
 * The accounts' total at one point. Each account counts at its newest balance-carrying row on or
 * before the point; an account with no such row counts at its opening balance, once the point
 * reaches the date it was recorded. An account with neither, or whose opening balance cannot be
 * converted to the viewer's currency at the point's rate, leaves the point incomplete.
 */
async function calculateAccountsHistoryTotal(accounts: Account[], toViewer: HistoryBalanceConverter, tenantKey: AppuserTenant['tenantKey'], pointDate: Date, isCurrentPoint: boolean, prefetched?: Map<number, Map<number, number>>, partOf: (account: Account, value: number) => number = (_account, value) => value): Promise<[null | number, boolean]> {
  const relevantAccounts = relevantAccountsAt(accounts, pointDate);
  if (relevantAccounts.length === 0) return [0, true];

  // Every balance is converted to the viewer's currency before it is added; one that cannot be
  // leaves the point incomplete. A member's history takes their part of each converted balance, by
  // today's shares at every point.
  const totalOf = (valueOf: (account: Account) => null | number): [null | number, boolean] => {
    const values = relevantAccounts.map((account) => {
      const value = valueOf(account);
      return value == null ? null : partOf(account, value);
    });
    if (values.some((value) => value == null)) return [null, false];
    return [sumMoney(values), true];
  };

  if (isCurrentPoint) return totalOf((account) => toViewer.runningBalance(account, account.appuserCurrencyBalance, pointDate));
  // Prefer the single prefetched lateral-join result. The per-point fallback is kept for
  // callers (and tests) that invoke this directly without a prefetch.
  const rowBalances = prefetched?.get(pointDate.getTime()) ?? await loadAccountBalancesAt(relevantAccounts, tenantKey, pointDate);
  return totalOf((account) => {
    const rowBalance = rowBalances.get(account.accountKey);
    return rowBalance == null ? toViewer.openingBalance(account, pointDate) : toViewer.runningBalance(account, rowBalance, pointDate);
  });
}

/** Converts an account's balances or a portfolio's snapshot at a history point into the viewer's currency; null when it cannot. */
interface HistoryBalanceConverter {
  /** The opening balance, in the account's own currency; null before it was recorded or without one. */
  openingBalance(account: Account, pointDate: Date): null | number;
  /** A portfolio snapshot, in the currency it was stored in, at the rate at the end of its own day (see `historyInViewerCurrency`). */
  portfolioSnapshot(snapshot: PortfolioSnapshotValue): null | number;
  /** A running balance, in the account owner's currency. */
  runningBalance(account: Account, balance: null | number | undefined, pointDate: Date): null | number;
}

async function calculateLoansHistoryTotal(loans: Loan[], currencyCode: string, pointDate: Date): Promise<[null | number, boolean]> {
  let total = 0;
  const asOfDate = new Date(nextUtcDay(pointDate).getTime() - 1);
  for (const loan of loans) {
    if (loan.currencyKey.code !== currencyCode) return [null, false];
    if (loan.openingBalanceDate > pointDate) continue;
    const [adjustments, repayments] = await Promise.all([
      DI.em.find(LoanAdjustment, { deletedAt: undefined, effectiveDate: { $lt: nextUtcDay(pointDate) }, loanKey: loan }, { orderBy: { effectiveDate: 'ASC', loanAdjustmentKey: 'ASC' } }),
      DI.em.find(LoanRepaymentLink, { deletedAt: undefined, loanKey: loan, paymentDate: { $lt: nextUtcDay(pointDate) } }, { orderBy: { loanRepaymentLinkKey: 'ASC', paymentDate: 'ASC' } }),
    ]);
    total = addMoney(total, calculateOutstandingPrincipalWithAdjustments({ adjustments: adjustments.map((adj) => ({ amount: adj.amount, effectiveDate: adj.effectiveDate, type: adj.type })), asOfDate, openingPrincipalBalance: loan.openingPrincipalBalance, principalRepayments: repayments.map((repayment) => ({ amount: repayment.principalAmount, effectiveDate: repayment.paymentDate })) }));
  }
  return [total, true];
}

/**
 * The manual assets' total at one point: each asset at its latest valuation on or before the
 * point (grown by its rule, if it has one), converted at the rate in force at the close of the
 * point's day. An asset with no valuation yet, or archived by then, adds nothing. One that cannot
 * be converted leaves the point incomplete, never added at face value.
 */
function calculateManualAssetsHistoryTotal(manualAssets: LoadedManualAsset[], viewerCurrency: string, rates: RateTable, pointDate: Date): [null | number, boolean] {
  const rateDate = new Date(nextUtcDay(pointDate).getTime() - 1);
  const values: number[] = [];
  for (const loaded of manualAssets) {
    const value = assetValueFor(loaded, viewerCurrency, rates, { rateDate, valueDate: pointDate });
    if (!value) continue;
    if (value.valueInViewerCurrency == null) return [null, false];
    values.push(value.valueInViewerCurrency);
  }
  return [sumMoney(values), true];
}

/**
 * The portfolios' total at one point: each portfolio at its latest snapshot on or before the point,
 * converted into the viewer's currency. A portfolio with no snapshot yet, or whose snapshot cannot
 * be converted, leaves the point incomplete, never added at face value.
 */
function calculatePortfoliosHistoryTotal(portfolios: Portfolio[], toViewer: HistoryBalanceConverter, pointDate: Date, latestByPortfolio: Map<number, PortfolioSnapshotValue>, countedAccountKeys: ReadonlySet<number>): [null | number, boolean] {
  // A portfolio inside an account counted at this point adds nothing, and needs no snapshot.
  const relevantPortfolios = portfolios.filter((portfolio) => pointDate.getTime() >= startOfUtcDay(portfolio.createdAt).getTime()
    && portfolioCountedInAccount(portfolio, countedAccountKeys) == null);
  const values: number[] = [];
  for (const portfolio of relevantPortfolios) {
    const snapshot = latestByPortfolio.get(portfolio.portfolioKey);
    const value = snapshot ? toViewer.portfolioSnapshot(snapshot) : null;
    if (value == null) return [null, false];
    values.push(value);
  }
  return [sumMoney(values), true];
}

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function endOfUtcMonth(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)); }

function formatUtcDate(date: Date) { return date.toISOString().slice(0, 10); }

function historyBalanceConverter(viewerCurrency: string, rates: RateTable): HistoryBalanceConverter {
  // The rate in force at the close of the point's day.
  const closeOf = (pointDate: Date) => new Date(nextUtcDay(pointDate).getTime() - 1);
  const convert = (amount: number, from: string | undefined, pointDate: Date): null | number => {
    if (!from) return null;
    const rate = rates.rateOn(from, viewerCurrency, closeOf(pointDate));
    if (rate == null) return null;
    return Money.toNumber(Money.convert(Money.of(amount, from), { rate, to: viewerCurrency }));
  };
  return {
    openingBalance: (account, pointDate) => {
      if (account.openingBalance == null || account.openingBalanceDate == null) return null;
      if (pointDate.getTime() < startOfUtcDay(account.openingBalanceDate).getTime()) return null;
      return convert(account.openingBalance, account.currencyKey.code, pointDate);
    },
    portfolioSnapshot: (snapshot) => snapshotInViewerCurrency(snapshot, viewerCurrency, rates),
    runningBalance: (account, balance, pointDate) => {
      if (balance == null) return null;
      return convert(balance, account.accountOwnerAppuserKey?.currencyKey.code, pointDate);
    },
  };
}

/** The currency pairs the history converts through: owners' running balances and accounts' opening balances. */
function historyRatePairs(accounts: Account[], viewerCurrency: string): CurrencyPair[] {
  const pairs: CurrencyPair[] = [];
  for (const account of accounts) {
    const ownerCurrency = account.accountOwnerAppuserKey?.currencyKey.code;
    if (ownerCurrency) pairs.push({ from: ownerCurrency, to: viewerCurrency });
    const accountCurrency = account.currencyKey.code;
    if (account.openingBalance != null && accountCurrency) pairs.push({ from: accountCurrency, to: viewerCurrency });
  }
  return pairs;
}

/**
 * The newest running balance in the user's currency of each account at `pointDate`, for callers
 * without a prefetch. `tenantKey` arrives as either a loaded entity reference or a bare number.
 */
async function loadAccountBalancesAt(accounts: Account[], tenantKey: AppuserTenant['tenantKey'], pointDate: Date): Promise<Map<number, number>> {
  const transactions = await DI.em.find(Transaction, excludeExpired({ accountKey: { $in: accounts }, deletedAt: undefined, tenantKey, transactionDate: { $lt: nextUtcDay(pointDate) } }), { orderBy: { transactionDate: 'DESC', transactionKey: 'DESC' } });
  const byAccount = new Map<number, number>();
  for (const transaction of transactions) {
    const accountKey = transaction.accountKey?.accountKey;
    if (accountKey == null || byAccount.has(accountKey) || transaction.appuserCurrencyBalance == null) continue;
    byAccount.set(accountKey, transaction.appuserCurrencyBalance);
  }
  return byAccount;
}

/**
 * Each portfolio's latest snapshot holding a value on or before each point, keyed by point time
 * then portfolio key, in the currency it was stored in. Snapshots are read once for every point.
 */
async function loadPortfolioSnapshotsByPoint(portfolios: Portfolio[], pointDates: Date[]): Promise<Map<number, Map<number, PortfolioSnapshotValue>>> {
  const byPoint = new Map<number, Map<number, PortfolioSnapshotValue>>();
  if (portfolios.length === 0 || pointDates.length === 0) return byPoint;
  const lastPoint = new Date(Math.max(...pointDates.map((pointDate) => pointDate.getTime())));

  const ownerCurrency = new Map(portfolios.map((portfolio) => [portfolio.portfolioKey, portfolio.portfolioOwnerAppuserKey.currencyKey.code]));
  const rows = await DI.em.find(
    PortfolioSnapshot,
    { deletedAt: undefined, portfolioKey: { $in: portfolios }, snapshotDate: { $lt: nextUtcDay(lastPoint) } },
    { orderBy: [{ snapshotDate: 'ASC' }, { portfolioSnapshotKey: 'ASC' }], populate: ['appuserCurrencyKey', 'currencyKey'] },
  );
  // A snapshot with no value at all says nothing about the portfolio; an older one stands in.
  const snapshots = rows
    .filter((row) => row.appuserCurrencyTotalValue != null || row.totalValue != null)
    .map((row) => ({ portfolioKey: row.portfolioKey.portfolioKey, time: new Date(row.snapshotDate).getTime(), value: storedSnapshotValue(row, ownerCurrency.get(row.portfolioKey.portfolioKey)) }));

  // One sweep: points and snapshots both run oldest first, each point keeping the newest so far.
  const latest = new Map<number, PortfolioSnapshotValue>();
  let next = 0;
  for (const pointDate of pointDates.toSorted((a, b) => a.getTime() - b.getTime())) {
    const cutoff = nextUtcDay(pointDate).getTime();
    for (let snapshot = snapshots[next]; snapshot && snapshot.time < cutoff; snapshot = snapshots[++next]) latest.set(snapshot.portfolioKey, snapshot.value);
    byPoint.set(pointDate.getTime(), new Map(latest));
  }
  return byPoint;
}

function minDate(dates: Date[]): Date { return new Date(Math.min(...dates.map((date) => date.getTime()))); }

function nextUtcDay(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)); }

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
 * account had no balance-carrying row at that point; the caller then falls back to its opening
 * balance.
 */
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

function relevantAccountsAt(accounts: Account[], pointDate: Date): Account[] {
  return accounts.filter((account) => pointDate.getTime() >= startOfUtcDay(account.createdAt).getTime());
}

function resolveTenantKeyNumber(tenantKey: AppuserTenant['tenantKey']): number {
  return typeof tenantKey === 'number' ? tenantKey : (tenantKey as unknown as { tenantKey: number }).tenantKey;
}

function startOfUtcDay(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }

export default new NetWorthService();
