import type { Request, Response } from 'express';

import { authedContext } from '@middleware/authed-context';
import { removeTransactionSplits as removeTransactionSplitsService, setTransactionSplits as setTransactionSplitsService } from '@service/transaction/transaction-split.service';
import { zParse } from '@validators/parser';
import { removeTransactionSplitsRequestSchema, setTransactionSplitsRequestSchema } from '@validators/transaction-split';

import { DI } from '../app';

/** `PUT /v1/account/transaction/:transactionId/splits`: replace every line of the transaction's split. */
export async function setTransactionSplits(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    body,
    params: { transactionId },
  } = await zParse(setTransactionSplitsRequestSchema, req);
  const lines = body.map((line) => ({ amount: line.amount, categoryKey: line.categoryId, notes: line.notes }));
  const transaction = await setTransactionSplitsService(DI.em, { appuserKey, tenantKey }, transactionId, lines);
  return res.json({ transaction });
}

/** `DELETE /v1/account/transaction/:transactionId/splits`: remove the split; the largest line's category stays. */
export async function removeTransactionSplits(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    params: { transactionId },
  } = await zParse(removeTransactionSplitsRequestSchema, req);
  const transaction = await removeTransactionSplitsService(DI.em, { appuserKey, tenantKey }, transactionId);
  return res.json({ transaction });
}
