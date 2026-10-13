import type { Request, Response } from 'express';

import { sendCsv } from '@service/reports/csv';
import { buildSankeyCsv, getSankeyReport as getSankeyReportData } from '@service/reports/sankey.service';
import { zParse } from '@validators/parser';
import { reportsQuerySchema } from '@validators/reports';

export async function getSankeyReport(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(reportsQuerySchema, req);
  const data = await getSankeyReportData({ filters: query, tenant: req.tenant, user: req.user });
  return res.json({ data, filters: query, generatedAt: new Date().toISOString() });
}

export async function getSankeyReportCsv(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(reportsQuerySchema, req);
  const data = await getSankeyReportData({ filters: query, tenant: req.tenant, user: req.user });
  return sendCsv(res, 'sankey.csv', buildSankeyCsv(data));
}
