import express from 'express';

import { processSupportEmail } from '@controller/support';

const router = express.Router();

router.post('/email', processSupportEmail);

export default router;
