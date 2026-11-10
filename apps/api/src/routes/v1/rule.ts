import express from 'express';

import { applyAllRules, applyRule, createRule, deleteRule, getRules, previewRule, reorderRules, updateRule } from '@controller/rule';

const router = express.Router();

router.get('/', getRules);
router.post('/', createRule);
router.post('/preview', previewRule);
router.post('/apply-all', applyAllRules);
router.put('/order', reorderRules);
router.post('/:ruleId/apply', applyRule);
router.patch('/:ruleId', updateRule);
router.delete('/:ruleId', deleteRule);

export default router;
