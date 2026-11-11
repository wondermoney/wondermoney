import type { Request, Response } from 'express';

import { DI } from '@app/app';
import { InsightsService } from '@service/insights/insights.service';
import { BadRequestError } from '@utils/errors';
import { insightsQuerySchema } from '@validators/insights';
import { zParse } from '@validators/parser';

/**
 * `GET /v1/insights?month=YYYY-MM`: deterministic spending and budget-pace cards for the home.
 * Tenant-scoped by the router, viewer-scoped by the aggregation repository (private accounts are
 * the owner's only), and computed on demand — nothing is stored.
 */
export async function getInsights(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new BadRequestError('User not found');
  const { query } = await zParse(insightsQuerySchema, req);
  await DI.em.populate(req.user, ['currencyKey']);

  const result = await new InsightsService().getInsights({
    appuserKey: req.user.appuserKey,
    currency: req.user.currencyKey.code,
    month: query.month,
    tenantKey: req.tenant.tenantKey,
  });
  return res.json(result);
}
