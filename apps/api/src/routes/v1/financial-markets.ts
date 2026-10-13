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
// RAD-547 — vendor-cost budget for the routes that can reach EODHD. The shared helper keys on
// the verified Supabase subject (falling back to IP) instead of the old
// `req.user?.appuserKey ?? 'anonymous'` key, which collapsed every unidentified caller into a
// single bucket.
const marketDataLimiter = marketDataRateLimit();

// Only cache successful responses — a single FMP failure (rate limit, timeout, bad
// key) must never get cached and replayed to every subsequent caller for the route's
// full TTL (up to 3 days on some routes below).
const onlyCacheSuccess = (_req: express.Request, res: express.Response) => res.statusCode < 400;

// Watchlist is per-user data — never cached. Auth/tenant/demo-guard/subscription are
// already applied to this router at its mount in app.ts.
router.get('/watchlist', getWatchlist);
router.put('/watchlist/:symbol', addToWatchlist);
router.delete('/watchlist/:symbol', removeFromWatchlist);

router.get('/ticker/search', marketDataLimiter, cache('3 days', onlyCacheSuccess), searchTicker);
// 1 hour — matches the /quote cache below (RAD-649). This endpoint's DTO now
// carries a real-time-quote-derived price/changePercentage snapshot
// alongside the company profile, so it can no longer sit behind a
// longer/looser TTL than /quote without the two surfaces (Explorer, which
// reads this endpoint, and Watchlist, which reads /quote) drifting apart
// again for up to a day at a time.
router.get('/ticker/:ticker/info', marketDataLimiter, cache('1 hour', onlyCacheSuccess), getCompanyInformation);
router.get('/ticker/:ticker/historical-price', marketDataLimiter, cache('12 hours', onlyCacheSuccess), getHistoricalPrice);
router.get('/ticker/:ticker/historical-dividend', marketDataLimiter, cache('3 days', onlyCacheSuccess), getHistoricalDividend);
router.get('/ticker/:ticker/financials', marketDataLimiter, cache('3 days', onlyCacheSuccess), getFinancials);
router.get('/ticker/:ticker/earnings', marketDataLimiter, cache('3 days', onlyCacheSuccess), getEarnings);
router.get('/ticker/:ticker/quote', marketDataLimiter, cache('1 hour', onlyCacheSuccess), getQuote);
router.get('/ticker/:ticker/fundamentals', marketDataLimiter, cache('1 hour', onlyCacheSuccess), getFundamentals);
router.get('/ticker/:ticker/news', marketDataLimiter, cache('1 hour', onlyCacheSuccess), getNews);
// RAD-570 — the screener route is gone. EODHD serves `/screener` only on the
// "All World Extended" tier and up; our key 403s on it while every other market
// endpoint here returns 200. The `eodhd` client folds 401 and 403 into a single
// `auth_error`, so the entitlement gap surfaced as a 500 "credentials are
// invalid" and paged Sentry on a permanent, known condition.

export default router;
