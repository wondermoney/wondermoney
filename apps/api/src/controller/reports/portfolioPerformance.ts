import type { Request, Response } from 'express';

import { sendCsv } from '@service/reports/csv';
import {
  buildPortfolioPerformanceCsv,
  getPortfolioPerformanceReport as getPortfolioPerformanceReportData,
} from '@service/reports/portfolioPerformance.service';
import { zParse } from '@validators/parser';
import { reportsQuerySchema } from '@validators/reports';

export async function getPortfolioPerformanceReport(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(reportsQuerySchema, req);
  const data = await getPortfolioPerformanceReportData({ filters: query, tenant: req.tenant, user: req.user });
  return res.json({ data, filters: query, generatedAt: new Date().toISOString() });
}

export async function getPortfolioPerformanceReportCsv(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(reportsQuerySchema, req);
  const data = await getPortfolioPerformanceReportData({ filters: query, tenant: req.tenant, user: req.user });
  return sendCsv(res, 'portfolio-performance.csv', buildPortfolioPerformanceCsv(data));
}
