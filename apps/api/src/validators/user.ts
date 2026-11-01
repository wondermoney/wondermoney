import { z } from 'zod';

import { positiveIntId } from '@validators/shared';

/**
 * Name-shaped free text. `firstName` is interpolated into outbound email (household
 * invites) and rendered in shared-household UI, so it is constrained to characters a
 * human name can actually contain: letters (any script), combining marks, spaces and
 * the usual name punctuation. This closes the markup-injection vector at the source —
 * the email templates escape as well (defence in depth), but a name can never legitimately
 * contain `<`, `>`, `&` or control characters.
 */
const personNameSchema = z
  .string()
  .trim()
  .max(100)
  // The empty string stays valid: the controller treats a blank field as "no change", and
  // clients that submit the whole profile form send `''` for fields they did not touch.
  .regex(/^(?:[\p{L}\p{M}][\p{L}\p{M}\p{Zs}'’.-]*)?$/u, 'Name contains unsupported characters');

export const updateUserDataRequestSchema = z.object({
  body: z.object({
    currency: z
      .union([z.number(), z.string().max(10)])
      .optional()
      .transform((value) => (typeof value === 'undefined' ? undefined : positiveIntId.parse(value))),
    // `emailAddress` is deliberately NOT accepted here. The account email is the identity
    // Supabase verified at sign-in and the address every transactional email is delivered to;
    // letting an authenticated user PATCH an arbitrary, unverified address enabled signup
    // squatting (the auth callback refuses an email that already exists), broke household
    // invites for the squatted address, and misdirected the account's outbound mail.
    // Email changes must go through Supabase's verified change-email flow; `Appuser.emailAddress`
    // is reconciled from the verified token on the next `/v1/auth/callback`.
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    mobileNumber: z.string().max(20).optional(),
    mobileNumberPrefix: z.string().max(10).optional(),
  }),
});

export const completeOnboardingStepSchema = z.object({
  params: z.object({
    step: positiveIntId,
  }),
});

/**
 * `GET /v1/user/:userId/requisition/:requisitionId` resolves the owner from `req.user`, never
 * from `:userId`, and `:requisitionId` must not reach the query unvalidated. Bounding it to the
 * provider's id charset keeps an unbounded/typed-wrong value out of the ORM.
 */
export const getRequisitionRequestSchema = z.object({
  params: z.object({
    requisitionId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[\w.:-]+$/u, 'Invalid requisition id'),
  }),
});
