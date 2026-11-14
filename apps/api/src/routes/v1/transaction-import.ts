import express from 'express';

import { cancelTransactionImport, commitTransactionImport, createPdfTransactionImport, createTransactionImport, decideTransactionImportRows, getTransactionImport, mapTransactionImportAccounts, mapTransactionImportCategories, parseTransactionImport } from '@controller/transaction-import';
import { requireAiAllowance } from '@middleware/ai-allowance';
import { requireAiAllowed } from '@middleware/ai-enabled';
import { requireVerifiedEmailForAi } from '@middleware/email-verification';

const router = express.Router();

router.post('/', createTransactionImport);
// A PDF statement goes to the vision model: the same gates, in the same order, as receipt scanning.
router.post('/pdf', requireVerifiedEmailForAi, requireAiAllowed('statementImport'), requireAiAllowance('statementImport'), createPdfTransactionImport);
router.get('/:importId', getTransactionImport);
router.post('/:importId/parse', parseTransactionImport);
router.patch('/:importId/rows', decideTransactionImportRows);
router.patch('/:importId/account-mapping', mapTransactionImportAccounts);
router.patch('/:importId/category-mapping', mapTransactionImportCategories);
router.post('/:importId/commit', commitTransactionImport);
router.post('/:importId/cancel', cancelTransactionImport);

export default router;
