import express from 'express';

import { authCallback } from '@controller/auth';
import { demoSignIn } from '@controller/demo-sign-in';
import { pairDevice } from '@controller/mobile-pairing';
import { requireBearerAuth } from '@middleware/auth';

const router = express.Router();

router.post('/callback', requireBearerAuth, authCallback);
// Public: the phone trades the QR's single-use code for its own session. Rate-limited by the
// `pairing` family at the mount (`app.ts`), which is the unauthenticated edge of a session exchange.
router.post('/pair', pairDevice);
// Public: one-click sign-in to the read-only demo account, 404 unless `DEMO_SIGN_IN_ENABLED`.
// Its own `authExchange` store at the mount (`app.ts`), on top of this router's.
router.post('/demo', demoSignIn);

export default router;
