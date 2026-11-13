import { z } from 'zod';

import { HouseholdRole } from '@entity/AppuserTenant';
import { GRANTABLE_HOUSEHOLD_ROLES } from '@service/household/household-permissions';

/** A role an invite or a role change can grant: never `owner` (ownership moves by transfer). */
const grantableRole = z.enum(GRANTABLE_HOUSEHOLD_ROLES);

export const createHouseholdInviteSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    // Optional so a client from before roles still invites a member.
    role: grantableRole.default(HouseholdRole.MEMBER),
  }),
});

export const householdInviteIdSchema = z.object({
  params: z.object({
    inviteId: z.coerce.number().int().positive(),
  }),
});

export const householdMemberIdSchema = z.object({
  params: z.object({
    appuserKey: z.coerce.number().int().positive(),
  }),
});

export const changeHouseholdMemberRoleSchema = z.object({
  body: z.object({ role: grantableRole }),
  params: z.object({
    appuserKey: z.coerce.number().int().positive(),
  }),
});

export const transferHouseholdOwnershipSchema = z.object({
  body: z.object({
    appuserKey: z.number().int().positive(),
  }),
});

export const acceptHouseholdInviteSchema = z.object({
  params: z.object({
    token: z.string().min(1).max(256),
  }),
});

export const validateHouseholdInviteSchema = z.object({
  query: z.object({
    token: z.string().min(1),
  }),
});
