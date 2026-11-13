import { z } from 'zod';

import { PushDevicePlatform } from '@entity/PushDevice';
import { EXPO_PUSH_TOKEN_PATTERN } from '@service/push/push-device.service';

const expoPushToken = z.string().trim().max(255).regex(EXPO_PUSH_TOKEN_PATTERN, 'Expected an Expo push token');

export const registerPushDeviceSchema = z.object({
  body: z.object({
    appVersion: z.string().trim().min(1).max(32).optional(),
    platform: z.enum(PushDevicePlatform),
    token: expoPushToken,
  }).strict(),
});

export const unregisterPushDeviceSchema = z.object({
  params: z.object({ token: expoPushToken }),
});

export const patchPushPreferencesSchema = z.object({
  body: z
    .object({
      bankSyncAlerts: z.boolean().optional(),
      budgetAlerts: z.boolean().optional(),
      creditCardDueReminders: z.boolean().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, 'At least one preference is required'),
});
