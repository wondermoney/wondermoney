import { z } from 'zod';

import { canonicalUuidV4, positiveIntId } from '@validators/shared';

export const startBankConnectionRequestSchema = z.object({
  params: z.object({
    bankId: z.string(),
  }),
  query: z.object({
    redirectPage: z.string().optional().default('accounts'),
  }),
});

export const bankConnectionCallbackRequestSchema = z.object({
  query: z.object({
    details: z.string().optional(),
    error: z.string().optional(),
    redirectPage: z.string().optional().default('accounts'),
    ref: z.string(),
  }),
});

export const bankListByCountryRequestSchema = z.object({
  query: z.object({
    country: z.string().optional(),
  }),
});

export const bankSyncStatusRequestSchema = z.object({
  params: z.object({
    incidentId: canonicalUuidV4,
  }),
});

export const unlinkRequisitionRequestSchema = z.object({
  params: z.object({
    requisitionId: positiveIntId,
  }),
});
