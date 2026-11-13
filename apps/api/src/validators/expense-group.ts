import { z } from 'zod';

import { boundedLimit, finiteAmount, positiveIntId } from '@validators/shared';

/** Bounded so one request cannot fan out without limit. */
const MAX_PEOPLE = 50;

const name = z.string().trim().min(1).max(100);
/** Kept for the household's own reference; nothing is ever sent to it. Empty means none. */
const email = z.union([z.literal(''), z.email().max(254)]).nullable().optional().transform((value) => (value ? value : null));
const currencyCode = z.string().trim().regex(/^[a-z]{3}$/i, 'Currency must be a three-letter code').transform((value) => value.toUpperCase());
const groupParams = z.object({ groupId: positiveIntId });

const memberInput = z.object({
  email,
  /** The household member this person is; leave out for someone outside the household. Fixed once added. */
  householdMemberId: positiveIntId.nullable().optional(),
  /** Optional for a household member (their name is used). */
  name: z.string().trim().max(100).optional().default(''),
});

/** `POST /v1/expense-groups`: the creator joins as the first member. */
export const createExpenseGroupRequestSchema = z.object({
  body: z.object({
    currencyCode,
    members: z.array(memberInput).max(MAX_PEOPLE).optional().default([]),
    name,
  }),
});

export const expenseGroupRequestSchema = z.object({ params: groupParams });

/** `PATCH /v1/expense-groups/:groupId`. */
export const updateExpenseGroupRequestSchema = z.object({
  body: z.object({ archived: z.boolean().optional(), currencyCode: currencyCode.optional(), name: name.optional() }),
  params: groupParams,
});

/** `POST /v1/expense-groups/:groupId/members`. */
export const addExpenseGroupMemberRequestSchema = z.object({ body: memberInput, params: groupParams });

const memberParams = z.object({ groupId: positiveIntId, memberId: positiveIntId });

/** `PATCH /v1/expense-groups/:groupId/members/:memberId`: whether the person is of the household cannot change. */
export const updateExpenseGroupMemberRequestSchema = z.object({
  body: z.object({ email, name: name.optional() }),
  params: memberParams,
});

export const expenseGroupMemberRequestSchema = z.object({ params: memberParams });

/**
 * `POST /v1/expense-groups/:groupId/shares`: share a transaction (or change how it is shared).
 * `equal` needs only the people; `amounts` a positive amount per person adding up to the
 * transaction; `percentages` a percentage per person making 100. The service checks the rest.
 */
export const shareExpenseRequestSchema = z.object({
  body: z.object({
    /** Every share goes in this category; the transaction's current category when left out, uncategorized when null. */
    categoryId: positiveIntId.nullable().optional(),
    method: z.enum(['equal', 'amounts', 'percentages']),
    paidByMemberId: positiveIntId,
    shares: z.array(z.object({
      /** Positive, in the transaction's settlement currency (`amounts`). */
      amount: finiteAmount.optional(),
      memberId: positiveIntId,
      /** 0 to 100, at most 2 decimals (`percentages`). */
      percentage: finiteAmount.optional(),
    })).min(1).max(MAX_PEOPLE),
    transactionId: positiveIntId,
  }),
  params: groupParams,
});

const shareParams = z.object({ groupId: positiveIntId, transactionId: positiveIntId });
export const groupExpenseRequestSchema = z.object({ params: shareParams });

/** `POST /v1/expense-groups/:groupId/settlements`. */
export const recordSettlementRequestSchema = z.object({
  body: z.object({
    /** Positive, at most 4 decimals. */
    amount: finiteAmount.refine((value) => value > 0, { message: 'Must be greater than zero' }),
    /** The group's currency when left out. */
    currencyCode: currencyCode.optional(),
    fromMemberId: positiveIntId,
    notes: z.string().trim().max(500).nullable().optional().transform((value) => (value ? value : null)),
    /** The day the money changed hands. */
    settledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date as YYYY-MM-DD').refine((value) => Number.isFinite(Date.parse(`${value}T00:00:00Z`)), 'Invalid date'),
    toMemberId: positiveIntId,
    /** The household transaction that moved the money, if any. */
    transactionId: positiveIntId.nullable().optional(),
  }),
  params: groupParams,
});

export const groupSettlementRequestSchema = z.object({ params: z.object({ groupId: positiveIntId, settlementId: positiveIntId }) });

/** `GET /v1/expense-groups/:groupId/settlements/suggestions`: transactions that could be the money behind a settlement. */
export const settlementSuggestionsRequestSchema = z.object({
  params: groupParams,
  query: z.object({
    currencyCode: currencyCode.optional(),
    fromMemberId: positiveIntId,
    limit: boundedLimit({ defaultValue: 10, max: 50 }).optional().default(10),
    /** Matched in the description or the merchant's name; drops the date window. */
    search: z.string().trim().max(200).optional(),
    toMemberId: positiveIntId,
  }),
});
