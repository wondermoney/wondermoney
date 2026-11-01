import apicache from 'apicache';
import express from 'express';

import {
  getCompanyInformation,
  getEarnings,
  getFinancials,
  getFundamentals,
  getHistoricalDividend,
  getHistoricalPrice,
  getNews,
  getQuote,
  searchTicker,
} from '@controller/financial-markets';
import { addToWatchlist, getWatchlist, removeFromWatchlist } from '@controller/watchlist';
import { marketDataRateLimit } from '@middleware/rate-limit';

const router = express.Router();
const cache = apicache.middleware;
// Vendor-cost budget for the routes that can reach EODHD. The shared helper keys on the
// verified better-auth user (falling back to IP), never on one shared 'anonymous' bucket.
const marketDataLimiter = marketDataRateLimit();

// Only cache successful responses — a single provider failure (rate limit, timeout, bad
// key) must never get cached and replayed to every subsequent caller for the route's
// full TTL (up to 3 days on some routes below).
const onlyCacheSuccess = (_req: express.Request, res: express.Response) => res.statusCode < 400;

// Watchlist is per-user data — never cached. Auth/tenant/demo-guard/subscription are
// already applied to this router at its mount in app.ts.
router.get('/watchlist', getWatchlist);
router.put('/watchlist/:symbol', addToWatchlist);
router.delete('/watchlist/:symbol', removeFromWatchlist);

router.get('/ticker/search', marketDataLimiter, cache('3 days', onlyCacheSuccess), searchTicker);
// 1 hour — matches the /quote cache below. This endpoint's DTO carries a
// real-time-quote-derived price/changePercentage snapshot alongside the
// company profile, so a longer TTL than /quote would let the two surfaces
// (Explorer, which reads this endpoint, and Watchlist, which reads /quote)
// drift apart for up to a day at a time.
router.get('/ticker/:ticker/info', marketDataLimiter, cache('1 hour', onlyCacheSuccess), getCompanyInformation);
router.get('/ticker/:ticker/historical-price', marketDataLimiter, cache('12 hours', onlyCacheSuccess), getHistoricalPrice);
router.get('/ticker/:ticker/historical-dividend', marketDataLimiter, cache('3 days', onlyCacheSuccess), getHistoricalDividend);
router.get('/ticker/:ticker/financials', marketDataLimiter, cache('3 days', onlyCacheSuccess), getFinancials);
router.get('/ticker/:ticker/earnings', marketDataLimiter, cache('3 days', onlyCacheSuccess), getEarnings);
router.get('/ticker/:ticker/quote', marketDataLimiter, cache('1 hour', onlyCacheSuccess), getQuote);
router.get('/ticker/:ticker/fundamentals', marketDataLimiter, cache('1 hour', onlyCacheSuccess), getFundamentals);
router.get('/ticker/:ticker/news', marketDataLimiter, cache('1 hour', onlyCacheSuccess), getNews);
// No screener route: EODHD serves `/screener` only on the "All World Extended"
// tier and up, and the `eodhd` client folds that 403 into `auth_error`, which
// would surface as a 500 "credentials are invalid" and page Sentry.

export default router;
