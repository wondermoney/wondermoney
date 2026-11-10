import { z } from 'zod';

import { finiteAmount, positiveIntId } from '@validators/shared';

/** Bounded so one request cannot fan out without limit. */
const MAX_SPLIT_LINES = 50;

const splitLine = z.object({
  /** In the transaction's settlement currency, with its sign. */
  amount: finiteAmount,
  /** Null for an uncategorized line. */
  categoryId: positiveIntId.nullable(),
  notes: z.string().trim().max(500).nullable().optional().transform((value) => (value ? value : null)),
});

/**
 * `PUT /v1/account/transaction/:transactionId/splits`: the full list of lines, in order. The rules
 * that need the transaction (at least two lines, signs, the sum) are checked by the service.
 */
export const setTransactionSplitsRequestSchema = z.object({
  body: z.array(splitLine).max(MAX_SPLIT_LINES, `At most ${MAX_SPLIT_LINES} lines per split`),
  params: z.object({ transactionId: positiveIntId }),
});

export const removeTransactionSplitsRequestSchema = z.object({
  params: z.object({ transactionId: positiveIntId }),
});
