import express from 'express';

import { getAdminBankSyncHealth, listAdminFailingBankConnections } from '@controller/admin/bank-sync-health';
import { NotFoundError } from '@utils/errors';

/**
 * `/v1/admin/bank-sync`, mounted ahead of the rest of `/v1/admin` behind `requireInstanceAdmin`
 * (an instance admin session or the admin API key; everyone else gets 404). The router ends in a
 * 404 so an unknown path under it never falls through to the API-key-only `/v1/admin` mount.
 */
const router = express.Router();

router.get('/health', getAdminBankSyncHealth);
router.get('/failing', listAdminFailingBankConnections);
router.use((_req, _res, next) => {
  next(new NotFoundError());
});

export default router;
