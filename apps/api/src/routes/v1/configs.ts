import express from 'express';

import { getConfigs } from '@controller/configs';

const router = express.Router();

router.get('/', getConfigs);

export default router;
