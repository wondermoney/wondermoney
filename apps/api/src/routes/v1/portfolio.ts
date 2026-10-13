import express from 'express';

import {
  createPortfolio,
  createPortfolioImportSession,
  createPortfolioTransaction,
  deletePortfolio,
  deletePortfolioTransaction,
  getAggregateDashboard,
  getAllocation,
  getBrokers,
  getDividendIncome,
  getHoldingAnalystData,
  getHoldingValuation,
  getPerformance,
  getPortfolio,
  getPortfolioAllocation,
  getPortfolioCalendar,
  getPortfolioDashboard,
  getPortfolioDividendIncome,
  getPortfolioHistoryStatus,
  getPortfolioHoldings,
  getPortfolioPerformance,
  getPortfolios,
  getPortfoliosHoldings,
  getPortfoliosMetrics,
  getPortfoliosTransactions,
  getPortfolioTopMovers,
  getPortfolioTransactions,
  getTopMovers,
  getTransactionTypes,
  rebuildPortfolioSnapshot,
  updatePortfolio,
  updatePortfolioTransaction,
} from '@controller/portfolio';
import { marketDataRateLimit } from '@middleware/rate-limit';

const router = express.Router();
// RAD-547 — this used to be 60 requests / 15 min, the tightest limit in the API: a single
// portfolio page load costs six to eight of these, so eight page views exhausted it. It now
// shares the `marketData` family ceiling and keys on the verified Supabase subject.
const marketDataLimiter = marketDataRateLimit();

// Aggregate dashboard endpoints (must be before :portfolioId to avoid conflicts)
router.get('/dashboard', getAggregateDashboard);
router.get('/performance', marketDataLimiter, getPerformance);
router.get('/allocation', getAllocation);
router.get('/top-movers', getTopMovers);

// Existing aggregate endpoints
router.get('/', getPortfolios);
router.get('/transactions', getPortfoliosTransactions);
router.get('/holdings', getPortfoliosHoldings);
router.get('/brokers', getBrokers);
router.get('/transaction-types', getTransactionTypes);
router.get('/metrics', getPortfoliosMetrics);

// Calendar endpoints
router.get('/calendar', marketDataLimiter, getPortfolioCalendar);

// Dividend income (aggregate)
router.get('/dividend-income', getDividendIncome);

// Holding-level market-data endpoints (analyst/valuation stubbed — RAD-449, not covered by the EODHD plan)
router.get('/holding/:symbol/analyst', marketDataLimiter, getHoldingAnalystData);
router.get('/holding/:symbol/valuation', marketDataLimiter, getHoldingValuation);

// Individual portfolio endpoints
router.put('/:portfolioId', updatePortfolio);
router.delete('/:portfolioId', deletePortfolio);
router.get('/:portfolioId/history-status', marketDataLimiter, getPortfolioHistoryStatus);
router.get('/:portfolioId', getPortfolio);
router.get('/:portfolioId/dashboard', marketDataLimiter, getPortfolioDashboard);
router.get('/:portfolioId/performance', marketDataLimiter, getPortfolioPerformance);
router.get('/:portfolioId/allocation', marketDataLimiter, getPortfolioAllocation);
router.get('/:portfolioId/top-movers', marketDataLimiter, getPortfolioTopMovers);
router.post('/:portfolioId/snapshot/rebuild', rebuildPortfolioSnapshot);
router.post('/:portfolioId/import-sessions', createPortfolioImportSession);
router.get('/:portfolioId/transactions', marketDataLimiter, getPortfolioTransactions);
router.post('/:portfolioId/transaction', createPortfolioTransaction);
router.put('/:portfolioId/transaction/:transactionId', updatePortfolioTransaction);
router.delete('/:portfolioId/transaction/:transactionId', deletePortfolioTransaction);
router.get('/:portfolioId/holdings', marketDataLimiter, getPortfolioHoldings);
router.get('/:portfolioId/dividend-income', marketDataLimiter, getPortfolioDividendIncome);
router.post('/', createPortfolio);

export default router;
