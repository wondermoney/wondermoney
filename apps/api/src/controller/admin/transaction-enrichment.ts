import type { Request, Response } from 'express';

import { zParse } from '@app/validators/parser';
import { computeTransactionEnrichmentAcceptanceRate } from '@service/transaction-enrichment/transaction-enrichment-acceptance.service';
import { getTransactionEnrichmentAcceptanceRateRequestSchema } from '@validators/transaction-enrichment';

import { DI } from '../../app.js';

// Acceptance rate of AI category suggestions over N shadow suggestions. Cross-tenant
// read (spans every tenant's enrichment rows), hence admin-gated rather than on the user-facing surface.
export async function getTransactionEnrichmentAcceptanceRate(req: Request, res: Response): Promise<Response> {
  const { query } = await zParse(getTransactionEnrichmentAcceptanceRateRequestSchema, req);
  const result = await computeTransactionEnrichmentAcceptanceRate(DI.em, query);
  return res.json(result);
}
