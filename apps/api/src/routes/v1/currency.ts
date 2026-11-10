import express from 'express';

import { getExchangeRateOverrides, patchExchangeRateOverride, postExchangeRateOverride, removeExchangeRateOverride } from '@controller/currency';

const router = express.Router();

router.get('/rates', getExchangeRateOverrides);
router.post('/rates', postExchangeRateOverride);
router.patch('/rates/:overrideId', patchExchangeRateOverride);
router.delete('/rates/:overrideId', removeExchangeRateOverride);

export default router;
