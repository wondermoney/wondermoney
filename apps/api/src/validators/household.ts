import { z } from 'zod';

export const createHouseholdInviteSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
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

export const validateHouseholdInviteSchema = z.object({
  query: z.object({
    token: z.string().min(1),
  }),
});
