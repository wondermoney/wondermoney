import express from 'express';

import { applyAllRules, applyRule, createRule, deleteRule, dismissRuleSuggestion, exportRules, getRules, importRules, previewRule, reorderRules, updateRule } from '@controller/rule';
import { getRulePreset, getRulePresets, installRulePreset } from '@controller/rule-preset';

const router = express.Router();

router.get('/', getRules);
router.post('/', createRule);
router.get('/export', exportRules);
router.post('/import', importRules);
router.get('/presets', getRulePresets);
router.get('/presets/:code', getRulePreset);
router.post('/presets/:code/install', installRulePreset);
router.post('/preview', previewRule);
router.post('/apply-all', applyAllRules);
router.post('/suggestions/dismiss', dismissRuleSuggestion);
router.put('/order', reorderRules);
router.post('/:ruleId/apply', applyRule);
router.patch('/:ruleId', updateRule);
router.delete('/:ruleId', deleteRule);

export default router;
