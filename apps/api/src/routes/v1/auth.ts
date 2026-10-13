import express from 'express';

import { authCallback } from '@controller/auth';
import { requireBearerAuth } from '@middleware/auth';

const router = express.Router();

router.post('/callback', requireBearerAuth, authCallback);

export default router;
