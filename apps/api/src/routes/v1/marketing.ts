import express from 'express';

import { applyGlobalEmailOptOut, inspectGlobalEmailOptOut } from '@controller/email-notifications';

const router = express.Router();

// GET validates a browser link and presents confirmation data; POST performs RFC one-click opt-out.
router.get('/email-opt-out', inspectGlobalEmailOptOut);
router.post('/email-opt-out', applyGlobalEmailOptOut);

export default router;
