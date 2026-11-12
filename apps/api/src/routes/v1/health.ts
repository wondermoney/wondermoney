import express from 'express';
import { StatusCodes } from 'http-status-codes';

import { DI } from '@app/app';
import { adminAuth } from '@middleware/auth';
import { publicReadRateLimit } from '@middleware/rate-limit';
import { checkReadiness, type ReadinessReport } from '@service/health/readiness.service';
import { marketDataProviderStatus } from '@service/market-data/registry';
import { GITHUB_SHA, IS_PROD } from '@utils/constants';

const router = express.Router();

/**
 * Monitors poll readiness on their own schedule, so one answer serves every caller for a few
 * seconds: a burst of probes costs at most one set of queries.
 */
const READINESS_CACHE_MS = 5_000;
let readiness: undefined | { at: number; report: Promise<ReadinessReport> };

const currentReadiness = (): Promise<ReadinessReport> => {
  const now = Date.now();
  if (readiness && now - readiness.at < READINESS_CACHE_MS) return readiness.report;
  const report = checkReadiness({ execute: (sql) => DI.em.getConnection().execute(sql) });
  readiness = { at: now, report };
  return report;
};

/**
 * Readiness, for uptime monitors: 200 when the database answers, no queue is backed up and the
 * worker ran a job recently; 503 otherwise. Public, so it reports fixed reasons only. `GET /` stays
 * the cheap liveness check that container health checks use.
 */
router.get('/ready', publicReadRateLimit(), async (_req, res) => {
  const report = await currentReadiness();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(report.status === 'ok' ? StatusCodes.OK : StatusCodes.SERVICE_UNAVAILABLE).json(report);
});

router.get('/', async (_req, res) => {
  if (IS_PROD && process.env['PUBLIC_DIAGNOSTICS_ENABLED'] !== 'true') {
    return res.status(StatusCodes.OK).json({ status: 'ok' });
  }

  return res.status(StatusCodes.OK).json({
    db: {
      connected: await DI.em.getConnection().isConnected(),
    },
    gitCommitHash: GITHUB_SHA,
    status: 'ok',
    timestampInISO: new Date().toISOString(),
    uptimeInSeconds: process.uptime(),
  });
});

const detailedHealthHandler = async (_req: express.Request, res: express.Response) => {
  return res.status(StatusCodes.OK).json({
    db: {
      connected: await DI.em.getConnection().isConnected(),
    },
    gitCommitHash: GITHUB_SHA,
    // The market-data providers `MARKET_DATA_PROVIDERS` lists, in order, and whether each is set up.
    marketData: { providers: marketDataProviderStatus() },
    status: 'ok',
    timestampInISO: new Date().toISOString(),
    uptimeInSeconds: process.uptime(),
  });
};

if (IS_PROD && process.env['PUBLIC_DIAGNOSTICS_ENABLED'] !== 'true') {
  router.get('/details', adminAuth, detailedHealthHandler);
} else {
  router.get('/details', detailedHealthHandler);
}

export default router;
