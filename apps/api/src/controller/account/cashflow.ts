import { QueryOrder, raw } from '@mikro-orm/core';
import type { Request, Response } from 'express';

import { Transaction } from '@entity/Transaction';
import { getAccountsCashflowRequestSchema } from '@validators/account';
import { zParse } from '@validators/parser';

import { DI } from '../../app.js';

export async function getAccountsCashflow(req: Request, res: Response) {
  const {
    query: { fromDate },
  } = await zParse(getAccountsCashflowRequestSchema, req);

  const cashflow: {
    amount: number;
    date: string;
  }[] = await DI.em
    .createQueryBuilder(Transaction, 't')
    .select([
      raw(`DATE_TRUNC('month', t.transaction_date) as date`),
      raw('ROUND(CAST(SUM(t.appuser_settlement_amount) as numeric), 2) as amount'),
    ])
    // RAD-343: QueryBuilder.execute() bypasses the tenant filter, so scope explicitly
    // by tenant + per-account privacy (a private account's transactions are owner-only).
    .where({
      accountKey: {
        $or: [{ isPrivate: false }, { accountOwnerAppuserKey: req.user }],
        deletedAt: undefined,
      },
      deletedAt: undefined,
      hidden: false,
      tenantKey: req.tenant,
    })
    .andWhere(fromDate ? { transactionDate: { $gte: fromDate } } : {})
    .groupBy(raw(`DATE_TRUNC('month', t.transaction_date)`))
    .orderBy({
      [raw(`DATE_TRUNC('month', t.transaction_date)`)]: QueryOrder.DESC,
    })
    .execute();

  const formattedCashflow = cashflow.map((row) => ({
    amount: row.amount,
    date: new Date(row.date).toISOString(),
  }));

  return res.json({ cashflow: formattedCashflow });
}
