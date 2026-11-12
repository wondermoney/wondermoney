import express from 'express';

import { applyAllRules, applyRule, createRule, deleteRule, dismissRuleSuggestion, exportRules, getRules, importRules, previewRule, reorderRules, updateRule } from '@controller/rule';

const router = express.Router();

router.get('/', getRules);
router.post('/', createRule);
router.get('/export', exportRules);
router.post('/import', importRules);
router.post('/preview', previewRule);
router.post('/apply-all', applyAllRules);
router.post('/suggestions/dismiss', dismissRuleSuggestion);
router.put('/order', reorderRules);
router.post('/:ruleId/apply', applyRule);
router.patch('/:ruleId', updateRule);
router.delete('/:ruleId', deleteRule);

export default router;
