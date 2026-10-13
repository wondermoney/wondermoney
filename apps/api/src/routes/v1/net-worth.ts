import express from 'express';

import { getNetWorth, getNetWorthHistory } from '@controller/net-worth';

const router = express.Router();

router.get('/history', getNetWorthHistory);
router.get('/', getNetWorth);

export default router;
