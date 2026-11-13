import type { NextFunction, Request, Response } from 'express';

import { DI } from '@app/app';
import { accountActor, assertAccountWritable, assertTransactionWritable } from '@service/account/account-access';

/**
 * Route guards for writes to one account's data (`services/account/account-access.ts`): a member
 * who can only view the account gets 403 `account_read_only`, one who cannot see it 404. Placed on
 * the write routes whose path names the account (`:accountId`) or a transaction on it
 * (`:transactionId`); writes that name their accounts elsewhere check in their service.
 * `account-write-guard.http.test.ts` sends every such route as a view-only member.
 */
const positiveInt = (value: unknown): null | number => {
  const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export async function requireWritableAccount(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const accountKey = positiveInt(req.params['accountId']);
    // A malformed id is the handler's validation error, not this guard's.
    if (accountKey !== null) await assertAccountWritable(DI.em, accountKey, accountActor(req));
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireWritableTransaction(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const transactionKey = positiveInt(req.params['transactionId']);
    if (transactionKey !== null) await assertTransactionWritable(DI.em, transactionKey, accountActor(req));
    next();
  } catch (error) {
    next(error);
  }
}
