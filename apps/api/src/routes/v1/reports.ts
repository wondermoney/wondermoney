import express from 'express';

import {
  getBudgetVsActualReport,
  getBudgetVsActualReportCsv,
  getCashflowReport,
  getCashflowReportCsv,
  getNetWorthHistoryReport,
  getNetWorthHistoryReportCsv,
  getPortfolioPerformanceReport,
  getPortfolioPerformanceReportCsv,
  getSankeyReport,
  getSankeyReportCsv,
  getSpendingByCategoryReport,
  getSpendingByCategoryReportCsv,
} from '@controller/reports';

const router = express.Router();

router.get('/spending-by-category', getSpendingByCategoryReport);
router.get('/spending-by-category.csv', getSpendingByCategoryReportCsv);
router.get('/cashflow', getCashflowReport);
router.get('/cashflow.csv', getCashflowReportCsv);
router.get('/sankey', getSankeyReport);
router.get('/sankey.csv', getSankeyReportCsv);
router.get('/net-worth-history', getNetWorthHistoryReport);
router.get('/net-worth-history.csv', getNetWorthHistoryReportCsv);
router.get('/budget-vs-actual', getBudgetVsActualReport);
router.get('/budget-vs-actual.csv', getBudgetVsActualReportCsv);
router.get('/portfolio-performance', getPortfolioPerformanceReport);
router.get('/portfolio-performance.csv', getPortfolioPerformanceReportCsv);

export default router;
