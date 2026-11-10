import type { EntityManager } from '@mikro-orm/core';
import type { Big } from 'big.js';

import { rateScope } from '@service/currency/exchange-rate';
import { amountInCurrencySql, completenessFromCounts, loadDailyRates, needsRateSql, type ReportCompleteness, transactionDaySql, type UnconvertedCount } from '@service/reports/report-currency';
import { big, toNumber } from '@utils/money';

import { categoryLinesSql } from './category-lines';
import type { SqlCondition } from './transaction-scope';

export interface TransactionTotals {
  completeness: ReportCompleteness;
  /** Rows totalled, those left out of the amount included. */
  count: number;
  /** By `YYYY-MM`, newest first; one entry keyed `''` without `byMonth`. */
  months: Map<string, TransactionMonthTotal>;
}

/** In the total's currency, to 4 decimals. */
export interface TransactionMonthTotal {
  /** Money in less money out. */
  amount: number;
  /** What the rows that add more than they take add up to. */
  moneyIn: number;
  /** What the rows that take more than they add take, as a positive amount. */
  moneyOut: number;
}

/**
 * The sum of a set of transactions in one currency, in SQL: the transaction list's total and the
 * dashboard's monthly cash flow are this one query, so they cannot disagree about the arithmetic.
 * It is the SQL counterpart of what the reports compute row by row in JavaScript
 * (`ReportCurrencyAmounts`, `spendingLinesOf`), and the consistency test holds the two equal.
 *
 * - **Currency.** A row's amount is read as `amountInCurrencySql`: its settlement amount when it
 *   was settled in the total's currency, else its amount in its member's currency, multiplied by
 *   the rate of its UTC day when that currency is another one. Rows are summed per member
 *   currency and day first, so each day's sum is converted once. A row with no converted amount,
 *   or no rate for its day, is left out and counted in `completeness`, never added at 1.
 * - **Lines.** With `lines`, a row adds only its category lines that pass (`category-lines.ts`):
 *   lines in categories that count as spending, lines in the filtered categories. Only a split
 *   row can have both kinds of line; any other row passes whole or not at all.
 * - **In and out.** A row is money in when what it adds (its lines that pass) is positive, money
 *   out when it is negative, as the cash flow report reads income and expenses.
 * - **Months.** With `byMonth`, rows are grouped by the month they fall in on the viewer's
 *   calendar: a bank booking (a date with no time) in the month of its own date, any other row in
 *   the month of its instant in `timeZone` (UTC when there is none), as `transactionCalendarDay`.
 */
export interface TransactionTotalsQuery {
  byMonth?: { timeZone?: string };
  currency: { code: string; currencyKey: number };
  lines?: { categoryKeys?: { includeUncategorized: boolean; keys: readonly number[] }; spendingOnly?: boolean };
  /** The rows to total, as a condition on the transaction aliased `t`. */
  rows: SqlCondition;
  tenantKey: number;
}


interface TotalGroup {
  /** Postgres sends a `numeric` sum and a `count` as strings. */
  amountIn: null | number | string;
  amountOut: null | number | string;
  /** The settlement currency of a row with no converted amount; the member currency of one that needs a rate. */
  currencyCode: null | string;
  /** The UTC day, only for rows that need a rate. */
  day: null | string;
  missing: boolean;
  month: null | string;
  transactions: number | string;
}

export async function getTransactionTotals(em: EntityManager, query: TransactionTotalsQuery): Promise<TransactionTotals> {
  const { currency, lines, rows, tenantKey } = query;
  const amount = amountInCurrencySql('t', currency.currencyKey);
  const needsRate = needsRateSql('t', currency.currencyKey);
  const leftOut = leftOutLinesSql(tenantKey, currency.currencyKey, lines);
  const month = query.byMonth
    ? `to_char(case when t.transaction_date = date_trunc('day', t.transaction_date, 'UTC') then t.transaction_date at time zone 'UTC' else t.transaction_date at time zone ? end, 'YYYY-MM')`
    : 'null::text';
  const params = [...(query.byMonth ? [query.byMonth.timeZone ?? 'UTC'] : []), ...rows.params];

  const groups = await em.getConnection().execute<TotalGroup[]>(
    `select ${month} as month,
       t.appuser_settlement_amount is null as missing,
       case when t.appuser_settlement_amount is null then settlement_currency.code when ${needsRate} then member_currency.code end as "currencyCode",
       case when ${needsRate} then ${transactionDaySql('t')} end as day,
       sum(case when kept.amount > 0 then kept.amount else 0 end) as "amountIn",
       sum(case when kept.amount < 0 then -kept.amount else 0 end) as "amountOut",
       count(*) as transactions
     from "transaction" t
     cross join lateral (select ${amount} - ${leftOut} as amount) kept
     left join "currency" member_currency on member_currency.currency_key = t.appuser_currency_key
     left join "currency" settlement_currency on settlement_currency.currency_key = t.settlement_currency_key
     where ${rows.sql}${query.byMonth ? ' and t.transaction_date is not null' : ''}
     group by 1, 2, 3, 4
     order by 1 desc`,
    params,
  );

  const unconverted: UnconvertedCount[] = groups.filter((group: TotalGroup) => group.missing);
  const converted = groups.filter((group: TotalGroup) => !group.missing);
  const rateFor = await loadDailyRates(em, currency.code, converted, rateScope(tenantKey));
  // Insertion order keeps the query's newest-month-first order.
  const totals = new Map<string, { in: Big; out: Big }>();
  let count = 0;
  for (const group of groups) {
    count += Number(group.transactions);
    const key = group.month ?? '';
    const total = totals.get(key) ?? { in: big(0), out: big(0) };
    totals.set(key, total);
    if (group.missing) continue;
    const rate = rateFor(group);
    if (rate == null) {
      // No rate converts this member's currency on that day: the month keeps its other rows.
      unconverted.push({ currencyCode: group.currencyCode, transactions: group.transactions });
      continue;
    }
    totals.set(key, { in: total.in.plus(big(group.amountIn ?? 0).times(big(rate))), out: total.out.plus(big(group.amountOut ?? 0).times(big(rate))) });
  }
  if (!query.byMonth && totals.size === 0) totals.set('', { in: big(0), out: big(0) });

  return {
    completeness: completenessFromCounts(currency.code, unconverted),
    count,
    months: new Map([...totals.entries()].map(([key, total]) => [key, { amount: toNumber(total.in.minus(total.out)), moneyIn: toNumber(total.in), moneyOut: toNumber(total.out) }])),
  };
}

/** The part of the row aliased `t` in lines the total does not add, in the total's currency before any rate. */
function leftOutLinesSql(tenantKey: number, currencyKey: number, lines: TransactionTotalsQuery['lines']): string {
  const kept: string[] = [];
  if (lines?.spendingOnly) kept.push('line.counts_as_spending');
  const categories = lines?.categoryKeys;
  if (categories && (categories.keys.length > 0 || categories.includeUncategorized)) {
    const keys = categories.keys.map((key) => {
      if (!Number.isSafeInteger(key)) throw new TypeError('category keys must be integers');
      return String(key);
    });
    const matches = [...(keys.length > 0 ? [`line.category_key = any(array[${keys.join(', ')}]::int[])`] : []), ...(categories.includeUncategorized ? ['line.category_key is null'] : [])];
    kept.push(`(${matches.join(' or ')})`);
  }
  if (kept.length === 0) return '0';
  return `coalesce((select sum(line.appuser_settlement_amount) from ${categoryLinesSql(tenantKey, { amountInCurrencyKey: currencyKey })} line
    where line.transaction_key = t.transaction_key and not coalesce(${kept.join(' and ')}, false)), 0)`;
}
