import express from 'express';

import { submitFeedback } from '@controller/feedback';

const router = express.Router();

router.post('/', submitFeedback);

export default router;
