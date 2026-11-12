import express from 'express';

import { chatWithAssistant, disableAssistant, getAssistantAuditLog, getAssistantConsent, updateAssistantConsent } from '@controller/assistant';
import { applyAssistantProposal, listAssistantProposals, rejectAssistantProposal } from '@controller/assistant-proposal';
import { requireAiAllowance } from '@middleware/ai-allowance';
import { requireAiAllowed } from '@middleware/ai-enabled';
import { requireVerifiedEmailForAi } from '@middleware/email-verification';

const router = express.Router();

router.get('/consent', getAssistantConsent);
router.post('/chat', requireVerifiedEmailForAi, requireAiAllowed('assistant'), requireAiAllowance('assistant'), chatWithAssistant);
router.post('/consent', updateAssistantConsent);
router.post('/disable', disableAssistant);
router.get('/audit-log', getAssistantAuditLog);
// Changes the assistant or an MCP client drafted, waiting for the member to apply or dismiss them.
router.get('/proposals', listAssistantProposals);
router.post('/proposals/:proposalId/apply', applyAssistantProposal);
router.post('/proposals/:proposalId/reject', rejectAssistantProposal);

export default router;
