import { z } from 'zod';

import { MEMBER_FILTER_VALUE, SHARED_MEMBER, singleMemberFilter } from '@service/household/member-attribution';

/**
 * `member`: one member's net worth (their appuser key), or `shared` for the joint accounts and
 * whatever someone who left the household owned (`member-attribution.ts`). Absent: the household's.
 */
const memberQuery = z
  .string()
  .regex(MEMBER_FILTER_VALUE, 'member must be a member key or "shared"')
  .optional()
  .transform((value) => (value === undefined ? undefined : singleMemberFilter(value === SHARED_MEMBER ? SHARED_MEMBER : Number(value))));

export const netWorthQuerySchema = z.object({
  query: z.object({ member: memberQuery }),
});

export const netWorthHistoryQuerySchema = z.object({
  query: z.object({
    granularity: z.enum(['monthly']).default('monthly').optional(),
    member: memberQuery,
    months: z.coerce.number().int().min(2).max(12).default(6).optional(),
    toDate: z.iso.date().optional(),
  }),
});
