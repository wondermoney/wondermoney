import { z } from 'zod';

import { TransactionTemplateDirection } from '@entity/TransactionTemplate';
import { finiteAmount, positiveIntId } from '@validators/shared';

const templateName = z.string().trim().min(1, 'Name is required').max(120);
const templateDescription = z.string().max(500).nullable().optional();
const templateNotes = z.string().max(1000).nullable().optional();
const direction = z.enum(TransactionTemplateDirection);

/** A positive magnitude: the direction, not the sign, says which way the money moves. */
const templateAmount = finiteAmount
  .refine((value) => value > 0, { message: 'Amount must be greater than zero' })
  .nullable()
  .optional();

const position = z.union([z.number(), z.string().regex(/^\d+$/)]).transform((value) => (typeof value === 'number' ? value : Number(value))).refine((value) => Number.isSafeInteger(value) && value >= 0, { message: 'Position must be a non-negative integer' });

const templateParams = z.object({ transactionTemplateId: positiveIntId });

/**
 * `POST /v1/transaction-template`. `name` and `direction` may be omitted only together with
 * `fromTransactionId`, which copies them (and every other field) from a transaction the member
 * can see; an explicit field always wins over the copied one.
 */
export const createTransactionTemplateSchema = z.object({
  body: z.object({
    accountKey: positiveIntId.nullable().optional(),
    amount: templateAmount,
    categoryKey: positiveIntId.nullable().optional(),
    description: templateDescription,
    direction: direction.optional(),
    fromTransactionId: positiveIntId.optional(),
    name: templateName.optional(),
    notes: templateNotes,
    position: position.optional(),
    transactionMerchantKey: positiveIntId.nullable().optional(),
  }),
});

export const updateTransactionTemplateSchema = z.object({
  body: z.object({
    accountKey: positiveIntId.nullable().optional(),
    amount: templateAmount,
    categoryKey: positiveIntId.nullable().optional(),
    description: templateDescription,
    direction: direction.optional(),
    name: templateName.optional(),
    notes: templateNotes,
    position: position.optional(),
    transactionMerchantKey: positiveIntId.nullable().optional(),
  }),
  params: templateParams,
});

export const deleteTransactionTemplateSchema = z.object({ params: templateParams });
