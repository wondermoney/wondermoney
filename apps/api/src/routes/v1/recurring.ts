import express from 'express';

import {
  confirmRecurringSeries,
  detectRecurring,
  dismissRecurringSeries,
  getRecurringItems,
  getRecurringSummary,
  updateRecurringSeries,
} from '@controller/recurring';

const router = express.Router();

router.get('/', getRecurringItems);
router.get('/summary', getRecurringSummary);
router.post('/detect', detectRecurring);
router.post('/:recurringSeriesId/confirm', confirmRecurringSeries);
router.post('/:recurringSeriesId/dismiss', dismissRecurringSeries);
router.patch('/:recurringSeriesId', updateRecurringSeries);

export default router;
