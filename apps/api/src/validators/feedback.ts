import { z } from 'zod';

export const submitFeedbackRequestSchema = z.object({
  body: z.object({
    message: z.string().trim().min(1).max(5000),
    /** The app page the user wrote from, for context. */
    page: z.string().trim().max(500).optional(),
    type: z.enum(['bug', 'feature_request', 'other']),
  }),
});
