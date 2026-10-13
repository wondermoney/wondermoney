import { z } from 'zod';

export const sendSupportEmailRequestSchema = z.object({
  body: z.object({
    captcha: z.string().max(2000).optional(),
    email: z.string().email().max(255),
    message: z.string().min(1).max(5000),
    name: z.string().min(1).max(200),
  }),
});
