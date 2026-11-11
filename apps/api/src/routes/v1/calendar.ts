import express from 'express';

import { getBillsCalendarFeed } from '@controller/calendar';

const router = express.Router();

// Public by token: calendar apps cannot send headers, so the feed token travels in the query and
// the handler resolves it itself. No bearer token can reach this mount.
router.get('/bills.ics', getBillsCalendarFeed);

export default router;
