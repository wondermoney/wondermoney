import { z } from 'zod';

import { positiveIntId, validDate } from '@validators/shared';

export const getBackgroundOperationRequestSchema = z.object({
  params: z.object({ operationId: z.string().min(1) }),
});

export const listAdminBackgroundOperationsRequestSchema = z.object({
  query: z.object({
    appuserKey: positiveIntId.optional(),
    from: validDate.optional(),
    limit: z.coerce.number().int().positive().max(200).refine(Number.isSafeInteger).default(50),
    offset: z.coerce.number().int().nonnegative().refine(Number.isSafeInteger).default(0),
    status: z.string().min(1).optional(),
    tenantKey: positiveIntId.optional(),
    to: validDate.optional(),
    type: z.string().min(1).optional(),
  }).strip(),
});

export const retryAdminBackgroundOperationRequestSchema = z.object({
  body: z.object({ reason: z.string().min(1).max(500).optional() }).default({}),
  params: z.object({ operationId: z.string().min(1) }),
});
