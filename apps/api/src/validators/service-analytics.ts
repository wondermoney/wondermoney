import { z } from 'zod';

/** `PUT /v1/user/me/service-analytics`: whether the API may record the person's service events. */
export const putServiceAnalyticsSchema = z.object({
  body: z.object({ enabled: z.boolean() }).strict(),
});
