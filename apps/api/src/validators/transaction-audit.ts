import { z } from 'zod';

import { positiveIntId, validDate } from '@validators/shared';

/**
 * Shared query shape for the admin audit-log reads: a `since` lower bound, offset
 * pagination (default 50, max 200), and optional tenant/appuser scoping. `.strip()` drops unknown
 * params rather than rejecting the request.
 */
const auditQuery = z.object({
  appuserKey: positiveIntId.optional(),
  limit: z.coerce.number().int().positive().max(200).refine(Number.isSafeInteger).default(50),
  offset: z.coerce.number().int().nonnegative().refine(Number.isSafeInteger).default(0),
  since: validDate.optional(),
  tenantKey: positiveIntId.optional(),
});

export const listDedupSkippedAuditRequestSchema = z.object({
  query: auditQuery.extend({
    accountKey: positiveIntId.optional(),
  }).strip(),
});

export const listRemediationAuditRequestSchema = z.object({
  query: auditQuery.extend({
    source: z.string().min(1).max(255).optional(),
  }).strip(),
});
