import type { Request, Response } from 'express';

import { buildBudgetVsActualCsv, getBudgetVsActualReport as getBudgetVsActualReportData } from '@service/reports/budgetVsActual.service';
import { sendCsv } from '@service/reports/csv';
import { zParse } from '@validators/parser';
import { reportsQuerySchema } from '@validators/reports';

export async function getBudgetVsActualReport(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(reportsQuerySchema, req);
  const data = await getBudgetVsActualReportData({ filters: query, tenant: req.tenant, user: req.user });
  return res.json({ data, filters: query, generatedAt: new Date().toISOString() });
}

export async function getBudgetVsActualReportCsv(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(reportsQuerySchema, req);
  const data = await getBudgetVsActualReportData({ filters: query, tenant: req.tenant, user: req.user });
  return sendCsv(res, 'budget-vs-actual.csv', buildBudgetVsActualCsv(data));
}
