import { z } from 'zod';

import { boundedLimit, finiteAmount, positiveIntId } from '@validators/shared';

const transactionParams = z.object({ transactionId: positiveIntId });

/**
 * `POST /v1/account/transaction/:transactionId/reimbursements`: link the transaction (money in) to
 * an expense. The rules that need both transactions (directions, currency, what is left to link)
 * are checked by the service.
 */
export const linkReimbursementRequestSchema = z.object({
  body: z.object({
    /** Positive, in the expense's settlement currency, at most 4 decimals. */
    amount: finiteAmount.refine((value) => value > 0, { message: 'Must be greater than zero' }),
    /** The expense (money out) this transaction reimburses. */
    expenseTransactionId: positiveIntId,
  }),
  params: transactionParams,
});

/** `GET /v1/account/transaction/:transactionId/reimbursements`: the transaction's links, either side. */
export const getTransactionReimbursementsRequestSchema = z.object({ params: transactionParams });

/** `GET /v1/account/transaction/:transactionId/reimbursements/suggestions`: candidates for the other side. */
export const getReimbursementSuggestionsRequestSchema = z.object({
  params: transactionParams,
  query: z.object({
    limit: boundedLimit({ defaultValue: 10, max: 50 }).optional().default(10),
    /** Matched in the description or the merchant's name; drops the date window and the amount rule. */
    search: z.string().trim().max(200).optional(),
  }),
});

/** `DELETE /v1/account/transaction/:transactionId/reimbursements/:reimbursementId`: unlink; the transaction may be either side. */
export const unlinkReimbursementRequestSchema = z.object({
  params: z.object({ reimbursementId: positiveIntId, transactionId: positiveIntId }),
});
