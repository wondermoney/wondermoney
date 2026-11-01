import { z } from 'zod';

import { EnableBankingReturnTo } from '@app/types/enable-banking-return-to';
import { canonicalUuidV4, positiveIntId } from '@validators/shared';

export const startBankConnectionRequestSchema = z.object({
  params: z.object({
    bankId: z.string(),
  }),
  query: z.object({
    /** Ignored. Sent by older mobile builds. */
    redirectPage: z.string().optional().default('accounts'),
    /** The client to send the browser back to after consent; anything else means the web app. */
    returnTo: z.enum(EnableBankingReturnTo).optional().catch(undefined),
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
