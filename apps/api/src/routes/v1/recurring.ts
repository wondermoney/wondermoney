import express from 'express';

import {
  confirmRecurringSeries,
  detectRecurring,
  dismissRecurringSeries,
  getRecurringItems,
  getRecurringOccurrences,
  getRecurringSummary,
  updateRecurringSeries,
} from '@controller/recurring';

const router = express.Router();

router.get('/', getRecurringItems);
router.get('/summary', getRecurringSummary);
router.get('/occurrences', getRecurringOccurrences);
router.post('/detect', detectRecurring);
router.post('/:recurringSeriesId/confirm', confirmRecurringSeries);
router.post('/:recurringSeriesId/dismiss', dismissRecurringSeries);
router.patch('/:recurringSeriesId', updateRecurringSeries);

export default router;
