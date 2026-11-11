import express from 'express';

import { authCallback } from '@controller/auth';
import { pairDevice } from '@controller/mobile-pairing';
import { requireBearerAuth } from '@middleware/auth';

const router = express.Router();

router.post('/callback', requireBearerAuth, authCallback);
// Public: the phone trades the QR's single-use code for its own session. Rate-limited by the
// `pairing` family at the mount (`app.ts`), which is the unauthenticated edge of a session exchange.
router.post('/pair', pairDevice);

export default router;
