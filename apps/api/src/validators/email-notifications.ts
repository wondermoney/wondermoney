import { z } from 'zod';

export const patchEmailNotificationPreferencesSchema = z.object({
  body: z
    .object({
      accountRecoveryEnabled: z.boolean().optional(),
      budgetAlertsEnabled: z.boolean().optional(),
      growthEmailsEnabled: z.boolean().optional(),
      marketingOptOut: z.boolean().optional(),
      weeklyInsightsEnabled: z.boolean().optional(),
    })
    .refine(
      (value) => Object.keys(value).length > 0,
      'At least one preference is required',
    ),
});

export const emailGlobalOptOutQuerySchema = z.object({
  query: z.object({ token: z.string().min(1).max(2048) }),
});

const optOutToken = z.string().min(1).max(2048);

export const emailGlobalOptOutPostSchema = z.object({
  body: z.object({ 'List-Unsubscribe': z.literal('One-Click') }).strict(),
  query: z.object({ token: optOutToken }),
});
