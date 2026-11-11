import type { Request, Response } from 'express';

import { sendCsv } from '@service/reports/csv';
import {
  getMonthComparisonCsv as getMonthComparisonCsvData,
  getMonthComparisonReport as getMonthComparisonReportData,
} from '@service/reports/monthComparison.service';
import { zParse } from '@validators/parser';
import { monthComparisonQuerySchema } from '@validators/reports';

export async function getMonthComparisonReport(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(monthComparisonQuerySchema, req);
  const { completeness, data } = await getMonthComparisonReportData(
    { filters: query, tenant: req.tenant, user: req.user },
    { base: query.base, compare: query.compare },
  );
  return res.json({ completeness, data, filters: query, generatedAt: new Date().toISOString() });
}

export async function getMonthComparisonReportCsv(req: Request, res: Response) {
  if (!req.user || !req.tenant) throw new Error('User not found');
  const { query } = await zParse(monthComparisonQuerySchema, req);
  const csv = await getMonthComparisonCsvData(
    { filters: query, tenant: req.tenant, user: req.user },
    { base: query.base, compare: query.compare },
  );
  return sendCsv(res, 'month-comparison.csv', csv);
}
