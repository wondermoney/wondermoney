import express from 'express';

import { chatWithAssistant, disableAssistant, getAssistantAuditLog, getAssistantConsent, updateAssistantConsent } from '@controller/assistant';
import { requireAiAllowance } from '@middleware/ai-allowance';
import { requireAiAllowed } from '@middleware/ai-enabled';
import { requireVerifiedEmailForAi } from '@middleware/email-verification';

const router = express.Router();

router.get('/consent', getAssistantConsent);
router.post('/chat', requireVerifiedEmailForAi, requireAiAllowed('assistant'), requireAiAllowance('assistant'), chatWithAssistant);
router.post('/consent', updateAssistantConsent);
router.post('/disable', disableAssistant);
router.get('/audit-log', getAssistantAuditLog);

export default router;
