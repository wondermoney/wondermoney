import express from 'express';

import { getBackgroundOperation } from '@controller/background-operation';

const router = express.Router();

router.get('/:operationId', getBackgroundOperation);

export default router;
