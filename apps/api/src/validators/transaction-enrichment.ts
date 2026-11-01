import { z } from 'zod';

// Admin-only observability read. `.strip()` drops unknown params rather than rejecting.
export const getTransactionEnrichmentAcceptanceRateRequestSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().positive().max(2000).refine(Number.isSafeInteger).optional(),
  }).strip(),
});
