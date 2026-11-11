import type { Request, Response } from 'express';

import { DI } from '@app/app';
import { getSpendingVsNormalReport as getSpendingVsNormalReportData } from '@service/reports/spendingVsNormal.service';
import { BadRequestError } from '@utils/errors';
import { zParse } from '@validators/parser';
import { spendingVsNormalQuerySchema } from '@validators/reports';

/**
 * `GET /v1/reports/spending-vs-normal?month=YYYY-MM`: this month's spend per category against
 * its three-month normal, top-level rows and their subcategories. Tenant-scoped by the router,
 * viewer-scoped by the aggregation repository (private accounts are the owner's only), and
 * computed on demand — nothing is stored.
 */
export async function getSpendingVsNormalReport(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new BadRequestError('User not found');
  const { query } = await zParse(spendingVsNormalQuerySchema, req);
  await DI.em.populate(req.user, ['currencyKey']);

  const { completeness, data } = await getSpendingVsNormalReportData(
    { filters: query, tenant: req.tenant, user: req.user },
    query.month,
  );
  return res.json({ completeness, data, filters: query, generatedAt: new Date().toISOString() });
}
