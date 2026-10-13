import type { Request, Response } from 'express';

import { sendCsv } from '@service/reports/csv';
import {
  buildNetWorthHistoryCsv,
  getNetWorthHistoryReport as getNetWorthHistoryReportData,
} from '@service/reports/netWorthHistory.service';
import { zParse } from '@validators/parser';
import { reportsQuerySchema } from '@validators/reports';

export async function getNetWorthHistoryReport(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(reportsQuerySchema, req);
  const data = await getNetWorthHistoryReportData({ filters: query, tenant: req.tenant, user: req.user });
  return res.json({ data, filters: query, generatedAt: new Date().toISOString() });
}

export async function getNetWorthHistoryReportCsv(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(reportsQuerySchema, req);
  const data = await getNetWorthHistoryReportData({ filters: query, tenant: req.tenant, user: req.user });
  return sendCsv(res, 'net-worth-history.csv', buildNetWorthHistoryCsv(data));
}
