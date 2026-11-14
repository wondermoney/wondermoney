import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
import { NotFoundError } from '@utils/errors';
import { addMoney } from '@utils/money';

import { getTransactionTotal } from './transaction-total.service';

/**
 * The home's review status: how many transactions are waiting for review, and what their
 * amounts add up to in the viewer's own currency.
 *
 * The rows are the review inbox's rows, not a second definition of them: the filters are the
 * list's default scope with `unreviewedOnly`, and the count and sum come from
 * `getTransactionTotal`, the same query behind `GET /v1/account/transaction`'s `total`. So the
 * count is the list's `total` for `unreviewedOnly=true`, and the tenant and privacy rules
 * (`transaction-scope.ts`) are applied once, where the list applies them.
 *
 * `totalAbs` is what is at stake rather than a net movement: a refund awaiting review adds to it
 * like a payment does. A row with no exchange rate is left out of the sum and still counted, as
 * the list leaves it out of `totalAmount`.
 */
export interface TransactionReviewSummary {
  /** Rows awaiting review, the list's `total` for `unreviewedOnly=true`. */
  count: number;
  /** The sum of their absolute amounts, in `currency`. */
  totalAbs: number;
  /** The viewer's base currency code. */
  currency: string;
}

export async function getTransactionReviewSummary(input: { tenantKey: number; viewerAppuserKey: number }): Promise<TransactionReviewSummary> {
  const viewer = await DI.em.findOne(Appuser, { appuserKey: input.viewerAppuserKey }, { populate: ['currencyKey'] });
  if (!viewer) throw new NotFoundError('User not found');

  const currency = { code: viewer.currencyKey.code, currencyKey: viewer.currencyKey.currencyKey };
  const total = await getTransactionTotal(
    { unreviewedOnly: true },
    { currency, tenantKey: input.tenantKey, viewerAppuserKey: input.viewerAppuserKey },
  );

  return { count: total.count, currency: currency.code, totalAbs: addMoney(total.moneyIn, total.moneyOut) };
}
