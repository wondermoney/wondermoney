import type { Request, Response } from 'express';

import { getCashflowCsv, getCashflowReport as getCashflowReportData } from '@service/reports/cashflow.service';
import { sendCsv } from '@service/reports/csv';
import { zParse } from '@validators/parser';
import { reportsQuerySchema } from '@validators/reports';

export async function getCashflowReport(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(reportsQuerySchema, req);
  const data = await getCashflowReportData({ filters: query, tenant: req.tenant, user: req.user });
  return res.json({ data, filters: query, generatedAt: new Date().toISOString() });
}

export async function getCashflowReportCsv(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(reportsQuerySchema, req);
  const csv = await getCashflowCsv({ filters: query, tenant: req.tenant, user: req.user });
  return sendCsv(res, 'cashflow.csv', csv);
}
