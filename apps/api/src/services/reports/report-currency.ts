import type { EntityManager } from '@mikro-orm/core';

import type { Appuser } from '@entity/Appuser';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import type { Tenant } from '@entity/Tenant';
import type { Transaction } from '@entity/Transaction';
import { loadRateTable, type RateTable } from '@service/currency/exchange-rate';
import { big, Money } from '@utils/money';

/**
 * Whether a report could value every row it was asked about in the viewer's currency.
 *
 * Household members each keep their own currency, and a transaction's `appuserSettlementAmount`
 * is in the currency of the member it belongs to (`appuserCurrencyKey`). A report converts each
 * row into the viewer's currency at the rate of the transaction's date; a row with no rate is left
 * out of the totals and counted here.
 */
export interface ReportCompleteness {
  currencyCode: string;
  isComplete: boolean;
  /** The currencies of the rows left out, when the endpoint reports them. */
  unconvertedCurrencies?: string[];
  unconvertedTransactions: number;
}

/** Rows a total had to leave out, counted per currency (`null` when a row records none). */
export interface UnconvertedCount {
  currencyCode: null | string;
  /** Postgres sends a `count` as a string. */
  transactions: number | string;
}

/**
 * The completeness block for a total summed in SQL from stored user-currency amounts: a row with
 * no converted amount (`fxStatus` `missing`) adds nothing to the sum, so it is counted here.
 */
export interface ReportResult<T> {
  completeness: ReportCompleteness;
  data: T;
}

/**
 * A currency's primary key for inlining into a raw SQL expression (so that a select and a group-by
 * can repeat the same text). Refuses anything but an integer.
 */
export function currencyKeySql(currencyKey: number): string {
  if (!Number.isSafeInteger(currencyKey)) throw new RangeError(`Not a currency key: ${String(currencyKey)}`);
  return String(currencyKey);
}

/**
 * The UTC calendar day of a transaction, as `YYYY-MM-DD`, for grouping rows before they are
 * converted. Rates are stored once a day at UTC midnight, so every moment of a UTC day takes the
 * same rate: converting a day's sum is exact, and needs one lookup instead of one per row.
 */
export function transactionDaySql(transactionAlias: string): string {
  return `to_char(${transactionAlias}.transaction_date AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
}

/** Amounts summed in SQL per currency and UTC day, to be converted into one target currency. */
export interface DailyCurrencyGroup {
  /** `null` when the rows record no currency: they are read in the target currency, as reports read them. */
  currencyCode: null | string;
  /** `YYYY-MM-DD` ({@link transactionDaySql}); not needed for rows already in the target currency. */
  day: null | string;
}

/** The rate for a {@link DailyCurrencyGroup}: 1 in the target currency, null when no rate is stored. */
export type DailyRateLookup = (group: DailyCurrencyGroup) => null | number;

/**
 * Load, in one pass, the rates that convert `groups` into `targetCurrency` at each group's day (the
 * latest rate stored on or before it). A missing rate is null, never 1.
 */
export function completenessFromCounts(currencyCode: string, counts: UnconvertedCount[]): ReportCompleteness {
  const unconvertedTransactions = counts.reduce((sum, row) => sum + Number(row.transactions), 0);
  const unconvertedCurrencies = [...new Set(counts.flatMap((row) => (row.currencyCode && Number(row.transactions) > 0 ? [row.currencyCode] : [])))].sort();
  return { currencyCode, isComplete: unconvertedTransactions === 0, unconvertedCurrencies, unconvertedTransactions };
}

export async function loadDailyRates(em: EntityManager, targetCurrency: string, groups: DailyCurrencyGroup[]): Promise<DailyRateLookup> {
  const dayOf = (day: string) => new Date(`${day}T00:00:00Z`);
  const foreign = groups.flatMap((group) => (group.currencyCode != null && group.currencyCode !== targetCurrency && group.day != null ? [{ currencyCode: group.currencyCode, day: group.day }] : []));
  let rates: null | RateTable = null;
  if (foreign.length > 0) {
    const days = foreign.map((group) => group.day).sort();
    const window = { from: dayOf(days[0] ?? ''), to: dayOf(days.at(-1) ?? '') };
    rates = await loadRateTable(em, foreign.map((group) => ({ from: group.currencyCode, to: targetCurrency })), window);
  }
  return (group) => {
    if (group.currencyCode == null || group.currencyCode === targetCurrency) return 1;
    if (!rates || group.day == null) return null;
    return rates.rateOn(group.currencyCode, targetCurrency, dayOf(group.day));
  };
}

/**
 * Add to a report query's `populate` so each row's currencies are loaded: the member currency of its
 * converted amount, and its settlement currency (named when a row has no converted amount).
 */
export const REPORT_CURRENCY_POPULATE = ['appuserCurrencyKey', 'settlementCurrencyKey'] as const;

type ReportTransaction = Pick<Transaction, 'appuserCurrencyKey' | 'appuserSettlementAmount' | 'editedSettlementAmount' | 'settlementAmount' | 'settlementCurrencyKey' | 'transactionDate' | 'transactionKey'>;

/**
 * A loan repayment link as a report reads it: the interest and fees, in the loan's currency.
 * Populate `loanKey.currencyKey` first ({@link loadLoanRepaymentLinks}).
 */
export type ReportLoanRepayment = Pick<LoanRepaymentLink, 'feeAmount' | 'interestAmount'> & { loanKey: { currencyKey: { code?: string } } };

/**
 * Every report transaction's amount in one currency: the viewer's for most reports, the budget's
 * for budget vs actual. Populate {@link REPORT_CURRENCY_POPULATE} first.
 */
export class ReportCurrencyAmounts {
  private readonly unconverted = new Set<number>();
  private readonly unconvertedCurrencies = new Set<string>();

  constructor(readonly currencyCode: string, private readonly rates: RateTable) {}

  /**
   * The amount in the report's currency, or null (and counted) when no rate converts it or no
   * converted amount was stored: the settlement amount when it is already in that currency, else
   * the amount stored in the member's currency, converted at the rate of the transaction's date.
   */
  amountOf(transaction: ReportTransaction): null | number {
    const value = this.moneyOf(transaction);
    if (value) return Money.toNumber(value);
    this.leaveOut(transaction, this.unconvertedCurrencyOf(transaction));
    return null;
  }

  completeness(): ReportCompleteness {
    return {
      currencyCode: this.currencyCode,
      isComplete: this.unconverted.size === 0,
      unconvertedCurrencies: [...this.unconvertedCurrencies].sort(),
      unconvertedTransactions: this.unconverted.size,
    };
  }

  /**
   * What the transaction adds to spending, as `calculateEffectiveSpendingAmount` reads it, in the
   * report's currency: its amount, or for a loan repayment its interest and fees (positive), which
   * are in the loan's currency and converted at the rate of the transaction's date. The payment's
   * own converted amount is not needed then. Null (and counted) when no rate converts it.
   */
  spendingAmountOf(transaction: ReportTransaction, repayments: readonly ReportLoanRepayment[]): null | number {
    if (repayments.length === 0) return this.amountOf(transaction);
    const costs: Money[] = [];
    for (const repayment of repayments) {
      const loanCurrency = repayment.loanKey.currencyKey.code;
      const cost = Money.of(big(repayment.interestAmount).plus(repayment.feeAmount), loanCurrency ?? this.currencyCode);
      const converted = loanCurrency && transaction.transactionDate ? this.convert(cost, transaction.transactionDate) : null;
      if (!converted) {
        this.leaveOut(transaction, loanCurrency ?? null);
        return null;
      }
      costs.push(converted);
    }
    return Money.toNumber(Money.sum(costs, this.currencyCode));
  }

  private convert(amount: Money, date: Date): Money | null {
    if (amount.currency === this.currencyCode) return amount;
    const rate = this.rates.rateOn(amount.currency, this.currencyCode, date);
    return rate == null ? null : Money.convert(amount, { rate, to: this.currencyCode });
  }

  private leaveOut(transaction: ReportTransaction, currencyCode: null | string | undefined) {
    this.unconverted.add(transaction.transactionKey);
    if (currencyCode) this.unconvertedCurrencies.add(currencyCode);
  }

  private moneyOf(transaction: ReportTransaction): Money | null {
    const currency = currencyOf(transaction, this.currencyCode);
    if (!currency) return null;
    // No converted amount was stored (no rate when the row was written): it is left out and
    // counted, never read as zero or at its settlement amount.
    if (transaction.appuserSettlementAmount == null) return null;
    // Settled in the report's currency: read as it is, exact, rather than converted into its
    // member's currency and back (a dollar expense of a euro member, shown to a dollar viewer).
    const settlementAmount = transaction.editedSettlementAmount ?? transaction.settlementAmount;
    if (settlementAmount != null && transaction.settlementCurrencyKey?.code === this.currencyCode) return Money.of(settlementAmount, this.currencyCode);
    if (!transaction.transactionDate) return null;
    return this.convert(Money.of(transaction.appuserSettlementAmount, currency), transaction.transactionDate);
  }

  /** The currency a row left out is in: its settlement currency when it has no converted amount, else its member's. */
  private unconvertedCurrencyOf(transaction: ReportTransaction): null | string | undefined {
    if (transaction.appuserSettlementAmount == null) return transaction.settlementCurrencyKey?.code;
    return currencyOf(transaction, this.currencyCode);
  }
}

/**
 * Load the rates needed to show `transactions` to `viewer`, in the viewer's currency. The report's
 * query populates {@link REPORT_CURRENCY_POPULATE}.
 */
export async function loadViewerCurrencyAmounts(em: EntityManager, viewer: Appuser, transactions: ReportTransaction[], repayments: ReadonlyMap<number, readonly ReportLoanRepayment[]> = new Map()): Promise<ReportCurrencyAmounts> {
  if (!viewer.currencyKey.code) await em.populate(viewer, ['currencyKey']);
  return loadReportCurrencyAmounts(em, viewer.currencyKey.code, transactions, repayments);
}

/**
 * Load the rates that convert `transactions` (and the interest and fees of their loan repayments,
 * keyed by transaction) into `currencyCode`, at each transaction's date.
 */
export async function loadReportCurrencyAmounts(em: EntityManager, currencyCode: string, transactions: ReportTransaction[], repayments: ReadonlyMap<number, readonly ReportLoanRepayment[]> = new Map()): Promise<ReportCurrencyAmounts> {
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  const pairs = [];
  for (const transaction of transactions) {
    if (!transaction.transactionDate) continue;
    const currencies = [currencyOf(transaction, currencyCode), ...(repayments.get(transaction.transactionKey) ?? []).map((repayment) => repayment.loanKey.currencyKey.code)];
    const foreign = currencies.filter((currency): currency is string => !!currency && currency !== currencyCode);
    if (foreign.length === 0) continue;
    for (const from of foreign) pairs.push({ from, to: currencyCode });
    earliest = Math.min(earliest, transaction.transactionDate.getTime());
    latest = Math.max(latest, transaction.transactionDate.getTime());
  }
  const window = pairs.length === 0 ? { from: new Date(), to: new Date() } : { from: new Date(earliest), to: new Date(latest) };
  return new ReportCurrencyAmounts(currencyCode, await loadRateTable(em, pairs, window));
}

/**
 * The live loan repayment links of `transactions`, keyed by transaction, with each loan's currency
 * loaded for {@link ReportCurrencyAmounts.spendingAmountOf}.
 */
export async function loadLoanRepaymentLinks(em: EntityManager, tenant: Tenant, transactions: Transaction[]): Promise<Map<number, LoanRepaymentLink[]>> {
  const byTransaction = new Map<number, LoanRepaymentLink[]>();
  if (transactions.length === 0) return byTransaction;
  const links = await em.find(LoanRepaymentLink, { deletedAt: undefined, tenantKey: tenant, transactionKey: { $in: transactions } }, { populate: ['loanKey.currencyKey'] });
  for (const link of links) {
    const transactionKey = link.transactionKey.transactionKey;
    const current = byTransaction.get(transactionKey);
    if (current) current.push(link);
    else byTransaction.set(transactionKey, [link]);
  }
  return byTransaction;
}

/**
 * Whether the row is money out. A row with a converted amount is read by its sign; one stored with
 * none (`fxStatus` `missing`) by the sign of its amount in the account's currency, so that a report
 * counts it as left out instead of silently dropping it.
 */
export function isMoneyOut(transaction: Pick<Transaction, 'appuserSettlementAmount' | 'editedSettlementAmount' | 'settlementAmount'>): boolean {
  if (transaction.appuserSettlementAmount != null) return transaction.appuserSettlementAmount < 0;
  return (transaction.editedSettlementAmount ?? transaction.settlementAmount ?? 0) < 0;
}

/**
 * The currency a transaction's user-currency amount is in. A row with none recorded is read in the
 * report's currency, as every report read it before members could differ. An unloaded reference
 * gives undefined, which converts to nothing rather than being guessed.
 */
function currencyOf(transaction: ReportTransaction, reportCurrency: string): string | undefined {
  return transaction.appuserCurrencyKey ? transaction.appuserCurrencyKey.code : reportCurrency;
}
