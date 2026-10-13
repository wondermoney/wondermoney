import express from 'express';

import { getInstance } from '@controller/instance';

const router = express.Router();

router.get('/', getInstance);

export default router;
