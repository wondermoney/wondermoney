import type { Request, Response } from 'express';

import { sendCsv } from '@service/reports/csv';
import {
  buildSpendingByCategoryCsv,
  getSpendingByCategoryReport as getSpendingByCategoryReportData,
} from '@service/reports/spendingByCategory.service';
import { zParse } from '@validators/parser';
import { reportsQuerySchema } from '@validators/reports';

export async function getSpendingByCategoryReport(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(reportsQuerySchema, req);
  const data = await getSpendingByCategoryReportData({ filters: query, tenant: req.tenant, user: req.user });
  return res.json({ data, filters: query, generatedAt: new Date().toISOString() });
}

export async function getSpendingByCategoryReportCsv(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(reportsQuerySchema, req);
  const data = await getSpendingByCategoryReportData({ filters: query, tenant: req.tenant, user: req.user });
  return sendCsv(res, 'spending-by-category.csv', buildSpendingByCategoryCsv(data));
}
