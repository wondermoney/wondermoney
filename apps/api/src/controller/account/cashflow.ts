import type { Big } from 'big.js';
import type { Request, Response } from 'express';

import { completenessFromCounts, currencyKeySql, loadDailyRates, transactionDaySql, type UnconvertedCount } from '@service/reports/report-currency';
import { notTransferSql } from '@service/reports/report-filters';
import { categoryLinesSql } from '@service/transaction/category-lines';
import { transactionDateRangeSql } from '@service/transaction/transaction-date-range';
import { notExpiredTransactionSql } from '@service/transaction/transaction-status';
import { big, roundDisplay } from '@utils/money';
import { getAccountsCashflowRequestSchema } from '@validators/account';
import { zParse } from '@validators/parser';

import { DI } from '../../app.js';

interface CashflowGroup {
  /** Postgres sends a `numeric` sum and a `count` as strings. */
  amount: number | string;
  /** The member currency the amounts are stored in (their account owner's). */
  currencyCode: null | string;
  date: Date | string;
  /** The UTC day, only for rows not already in the viewer's currency. */
  day: null | string;
  transactions: number | string;
}

/**
 * The household's monthly cash flow in the viewer's currency. A transaction's amount is stored in
 * its account owner's currency, so a partner's rows are converted at the rate of their date. Rows
 * are summed in SQL per month, currency and UTC day (rates are daily), and each day's sum is
 * converted once. A sum with no rate is left out and counted in `completeness`, never added at 1.
 *
 * The same exclusions as the reports: a transfer between own accounts (matched, or marked by the
 * user) is neither income nor spending, and neither is a category line in a category that is not
 * spending (`category-lines.ts`): only that line of a split is left out.
 */
export async function getAccountsCashflow(req: Request, res: Response) {
  const {
    query: { fromDate, timezone },
  } = await zParse(getAccountsCashflowRequestSchema, req);

  if (!req.user || !req.tenant) throw new Error('User not found');
  const viewer = req.user;
  if (!viewer.currencyKey.code) await DI.em.populate(viewer, ['currencyKey']);
  const viewerCurrency = viewer.currencyKey;
  const tenantKey = req.tenant.tenantKey;

  // From the first day the viewer picked; a bank booking counts from that calendar day.
  const inRange = transactionDateRangeSql('t.transaction_date', { from: fromDate, timeZone: timezone });
  // Raw SQL bypasses the tenant filter, so scope explicitly by tenant + per-account privacy (a
  // private account's transactions are owner-only). EXPIRED rows never moved money; PENDING still
  // counts. Hidden rows are left out.
  const where = `t.tenant_key = ? and t.deleted_at is null and t.hidden = false
    and a.tenant_key = ? and a.deleted_at is null and (a.is_private = false or a.account_owner_appuser_key = ?)
    and ${notExpiredTransactionSql('t')}
    and ${notTransferSql('t')}
    ${inRange ? `and ${inRange.sql}` : ''}`;
  const params = [tenantKey, tenantKey, viewer.appuserKey, ...(inRange?.params ?? [])];

  // Months of the UTC calendar, so a bank booking (stored at UTC midnight of its date) is in its own
  // month whatever the database session's time zone.
  const month = `DATE_TRUNC('month', t.transaction_date, 'UTC')`;
  // Rows already in the viewer's currency need no rate, so they are not split by day. The key is an
  // integer primary key, inlined so that the select and group-by expressions are the same text.
  const viewerCurrencyKey = currencyKeySql(viewerCurrency.currencyKey);
  const day = `CASE WHEN t.appuser_currency_key IS NULL OR t.appuser_currency_key = ${viewerCurrencyKey} THEN NULL ELSE ${transactionDaySql('t')} END`;
  // The part of each row in categories that are not spending: the whole row, or some split lines.
  const notSpending = `(select line.transaction_key, sum(line.appuser_settlement_amount) as amount
    from ${categoryLinesSql(tenantKey)} line where not line.counts_as_spending group by line.transaction_key)`;

  const connection = DI.em.getConnection();
  const groups = await connection.execute<CashflowGroup[]>(
    `select ${month} as date, amount_currency.code as "currencyCode", ${day} as day,
       SUM(t.appuser_settlement_amount - COALESCE(not_spending.amount, 0)) as amount, COUNT(*) as transactions
     from "transaction" t
     join "account" a on a.account_key = t.account_key
     left join "currency" amount_currency on amount_currency.currency_key = t.appuser_currency_key
     left join ${notSpending} not_spending on not_spending.transaction_key = t.transaction_key
     where ${where} and t.appuser_settlement_amount is not null
       and t.appuser_settlement_amount <> COALESCE(not_spending.amount, 0)
     group by ${month}, amount_currency.code, ${day}
     order by ${month} desc`,
    params,
  );

  // SUM skips a row with no converted amount (no rate for its currency when it was stored); count
  // those instead of letting the total look complete. A row wholly in categories that are not
  // spending would add nothing, so it is not counted either.
  const unconverted = await connection.execute<UnconvertedCount[]>(
    `select settlement_currency.code as "currencyCode", COUNT(*) as transactions
     from "transaction" t
     join "account" a on a.account_key = t.account_key
     left join "currency" settlement_currency on settlement_currency.currency_key = t.settlement_currency_key
     where ${where} and t.appuser_settlement_amount is null and t.transaction_date is not null
       and COALESCE((select bool_or(line.counts_as_spending) from ${categoryLinesSql(tenantKey)} line where line.transaction_key = t.transaction_key), true)
     group by settlement_currency.code`,
    params,
  );

  const rateFor = await loadDailyRates(DI.em, viewerCurrency.code, groups);
  // Insertion order keeps the query's newest-month-first order.
  const totals = new Map<string, Big>();
  for (const group of groups) {
    const date = new Date(group.date).toISOString();
    const total = totals.get(date) ?? big(0);
    const rate = rateFor(group);
    if (rate == null) {
      // No rate converts this member's currency on that day: the month keeps its other rows.
      unconverted.push({ currencyCode: group.currencyCode, transactions: group.transactions });
      totals.set(date, total);
      continue;
    }
    totals.set(date, total.plus(big(group.amount).times(big(rate))));
  }

  const cashflow = [...totals.entries()].map(([date, amount]) => ({ amount: roundDisplay(amount), date }));

  return res.json({ cashflow, completeness: completenessFromCounts(viewerCurrency.code, unconverted) });
}
