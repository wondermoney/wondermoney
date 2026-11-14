import express from 'express';

import { getBankList, getBankSyncStatus, startBankConnection, unlinkRequisition } from '@controller/banking';
import { getBankingAlerts } from '@controller/banking-alerts';
import { getBankConnections, getBankConnectionSyncs } from '@controller/banking-connections';
import { connectSimplefinBank, disconnectSimplefinBank, getSimplefinConnectionSyncs } from '@controller/banking-simplefin';
import { blockDemoStateChange } from '@middleware/demo';
import { bankConnectRateLimit } from '@middleware/rate-limit';

const router = express.Router();

router.get('/bank', getBankList);
router.get('/alerts', getBankingAlerts);
router.get('/connections', getBankConnections);
router.get('/connections/:connectionId/syncs', getBankConnectionSyncs);
router.get('/sync/:incidentId/status', getBankSyncStatus);
router.post('/simplefin/connections', blockDemoStateChange, bankConnectRateLimit(), connectSimplefinBank);
router.get('/simplefin/connections/:connectionId/syncs', getSimplefinConnectionSyncs);
router.delete('/simplefin/connections/:connectionId', disconnectSimplefinBank);
router.get('/bank/:bankId/start', blockDemoStateChange, startBankConnection);
router.delete('/requisition/:requisitionId', unlinkRequisition);

export default router;
