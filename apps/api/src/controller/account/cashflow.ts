import type { Request, Response } from 'express';

import { dashboardScope, transactionScopeSql } from '@service/transaction/transaction-scope';
import { getTransactionTotals } from '@service/transaction/transaction-totals';
import { roundDisplay } from '@utils/money';
import { getAccountsCashflowRequestSchema } from '@validators/account';
import { zParse } from '@validators/parser';

import { DI } from '../../app.js';

/**
 * The household's monthly cash flow in the viewer's currency, from the first day the viewer picked
 * (a bank booking counts from that calendar day). A month is of the viewer's calendar: a bank
 * booking is in the month of its own date, a card payment in the month of its instant in
 * `timezone` (UTC without one).
 *
 * Summed by the same query as the transaction list's total (`transaction-totals.ts`): a partner's
 * rows are converted at the rate of their date, a row settled in the viewer's currency is read at
 * its settlement amount, and a sum with no rate is left out and counted in `completeness`, never
 * added at 1.
 */
export async function getAccountsCashflow(req: Request, res: Response) {
  const {
    query: { fromDate, timezone },
  } = await zParse(getAccountsCashflowRequestSchema, req);

  if (!req.user || !req.tenant) throw new Error('User not found');
  const viewer = req.user;
  if (!viewer.currencyKey.code) await DI.em.populate(viewer, ['currencyKey']);
  const tenantKey = req.tenant.tenantKey;

  const scope = dashboardScope({ dateRange: { from: fromDate, timeZone: timezone }, tenantKey, viewerAppuserKey: viewer.appuserKey });
  const { completeness, months } = await getTransactionTotals(DI.em, {
    byMonth: { timeZone: timezone },
    currency: { code: viewer.currencyKey.code, currencyKey: viewer.currencyKey.currencyKey },
    lines: { spendingOnly: true },
    rows: transactionScopeSql('t', scope),
    tenantKey,
  });

  const cashflow = [...months.entries()].map(([month, total]) => ({ amount: roundDisplay(total.amount), date: `${month}-01T00:00:00.000Z` }));
  return res.json({ cashflow, completeness });
}
