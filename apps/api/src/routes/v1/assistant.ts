import express from 'express';

import { chatWithAssistant, disableAssistant, getAssistantAuditLog, getAssistantConsent, updateAssistantConsent } from '@controller/assistant';

const router = express.Router();

router.get('/consent', getAssistantConsent);
router.post('/chat', chatWithAssistant);
router.post('/consent', updateAssistantConsent);
router.post('/disable', disableAssistant);
router.get('/audit-log', getAssistantAuditLog);

export default router;
