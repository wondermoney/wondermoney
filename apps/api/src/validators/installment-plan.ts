import { z } from 'zod';

import { positiveIntId } from '@validators/shared';

/** The most installments one plan may have, and the fewest worth a plan. */
export const MAX_INSTALLMENT_COUNT = 120;
export const MIN_INSTALLMENT_COUNT = 2;
/** The largest purchase total accepted, in the account's currency. */
const MAX_TOTAL_AMOUNT = 1_000_000_000;

/** A calendar day (`YYYY-MM-DD`), read as midnight UTC. */
const calendarDay = z.iso.date().transform((value) => new Date(`${value}T00:00:00.000Z`));

const installmentCount = z.coerce.number().int().min(MIN_INSTALLMENT_COUNT).max(MAX_INSTALLMENT_COUNT);
/** A positive purchase total; stored rounded to cents. */
const totalAmount = z.coerce.number().positive().max(MAX_TOTAL_AMOUNT);
const description = z.string().trim().min(1).max(255);

const accountFilterQuery = z.object({ accountId: positiveIntId.optional() });
const planParams = z.object({ installmentPlanId: positiveIntId });

export const listInstallmentPlansRequestSchema = z.object({ query: accountFilterQuery });
export const listInstallmentCommitmentsRequestSchema = z.object({ query: accountFilterQuery });
export const listInstallmentSuggestionsRequestSchema = z.object({ query: accountFilterQuery });
export const getInstallmentPlanRequestSchema = z.object({ params: planParams });
export const deleteInstallmentPlanRequestSchema = z.object({ params: planParams });

export const createInstallmentPlanRequestSchema = z.object({
  body: z.object({
    accountKey: positiveIntId,
    categoryKey: positiveIntId.nullable().optional(),
    description,
    installmentCount,
    /** Posted transactions to link as they are created, as from an accepted suggestion. */
    links: z
      .array(z.object({ installmentNumber: z.coerce.number().int().min(1).max(MAX_INSTALLMENT_COUNT), transactionKey: positiveIntId }))
      .max(MAX_INSTALLMENT_COUNT)
      .optional(),
    purchaseDate: calendarDay,
    totalAmount,
  }),
});

export const updateInstallmentPlanRequestSchema = z.object({
  body: z
    .object({
      categoryKey: positiveIntId.nullable().optional(),
      description: description.optional(),
      installmentCount: installmentCount.optional(),
      purchaseDate: calendarDay.optional(),
      totalAmount: totalAmount.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' }),
  params: planParams,
});

const installmentParams = planParams.extend({ installmentNumber: z.coerce.number().int().min(1).max(MAX_INSTALLMENT_COUNT) });

export const linkInstallmentRequestSchema = z.object({
  body: z.object({ transactionKey: positiveIntId }),
  params: installmentParams,
});

export const unlinkInstallmentRequestSchema = z.object({ params: installmentParams });
