import express from 'express';

import { getBankList, getBankSyncStatus, startBankConnection, unlinkRequisition } from '@controller/banking';
import { getBankConnections } from '@controller/banking-connections';
import { blockDemoStateChange } from '@middleware/demo';

const router = express.Router();

router.get('/bank', getBankList);
router.get('/connections', getBankConnections);
router.get('/sync/:incidentId/status', getBankSyncStatus);
router.get('/bank/:bankId/start', blockDemoStateChange, startBankConnection);
router.delete('/requisition/:requisitionId', unlinkRequisition);

export default router;
