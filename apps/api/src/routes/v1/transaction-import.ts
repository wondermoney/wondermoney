import express from 'express';

import { cancelTransactionImport, commitTransactionImport, createTransactionImport, decideTransactionImportRows, getTransactionImport, mapTransactionImportAccounts, mapTransactionImportCategories, parseTransactionImport } from '@controller/transaction-import';

const router = express.Router();

router.post('/', createTransactionImport);
router.get('/:importId', getTransactionImport);
router.post('/:importId/parse', parseTransactionImport);
router.patch('/:importId/rows', decideTransactionImportRows);
router.patch('/:importId/account-mapping', mapTransactionImportAccounts);
router.patch('/:importId/category-mapping', mapTransactionImportCategories);
router.post('/:importId/commit', commitTransactionImport);
router.post('/:importId/cancel', cancelTransactionImport);

export default router;
