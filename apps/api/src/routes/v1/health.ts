import express from 'express';
import { StatusCodes } from 'http-status-codes';

import { DI } from '@app/app';
import { adminAuth } from '@middleware/auth';
import { GITHUB_SHA, IS_PROD } from '@utils/constants';

const router = express.Router();

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
