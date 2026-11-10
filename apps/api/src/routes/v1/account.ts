import apicache from 'apicache';
import express from 'express';

import {
  confirmTransactionOCRImportAndCreateTransaction,
  createOfflineAccount,
  createTransaction,
  createTransactionOCRImport,
  deleteAccount,
  getAccount,
  getAccountFinancialInstitutions,
  getAccountMetrics,
  getAccounts,
  getAccountsCashflow,
  getAccountsMetrics,
  getAccountTransactions,
  getAccountTypes,
  getCategorySpending,
  getCurrencies,
  getRecentTransactions,
  getS3PresignedUrlForCsvUpload,
  getTransactionHistory,
  getTransactionMerchants,
  getTransactions,
  getTransactionTypes,
  previewAccountCsvImport,
  rejectTransactionOCRImport,
  startAccountCsvImport,
  updateAccount,
  updateTransaction,
  updateTransactions,
} from '@controller/account';
import { setTransactionTags } from '@controller/tag';
import { removeTransactionSplits, setTransactionSplits } from '@controller/transaction-split';
import { requireAiAllowance } from '@middleware/ai-allowance';
import { requireVerifiedEmailForAi } from '@middleware/email-verification';
import multerSingleFile from '@middleware/multer';

const cache = apicache.middleware;
const router = express.Router();

router.get('/', getAccounts);
router.post('/offline', createOfflineAccount);
router.get('/transaction/category-spending', getCategorySpending);
router.patch('/transaction', updateTransactions);
router.patch('/transaction/:transactionId', updateTransaction);
router.get('/transaction/:transactionId/history', getTransactionHistory);
router.put('/transaction/:transactionId/tags', setTransactionTags);
router.put('/transaction/:transactionId/splits', setTransactionSplits);
router.delete('/transaction/:transactionId/splits', removeTransactionSplits);
router.get('/transaction', getTransactions);
router.get('/metrics', getAccountsMetrics);
router.get('/currencies', cache('1 day'), getCurrencies);
router.get('/transaction-types', cache('1 day'), getTransactionTypes);
router.get('/transaction-merchants', getTransactionMerchants);
router.get('/financial-institutions', cache('1 day'), getAccountFinancialInstitutions);
router.get('/account-types', cache('1 day'), getAccountTypes);
router.post('/transaction/ocr', requireVerifiedEmailForAi, requireAiAllowance('ocr'), multerSingleFile, createTransactionOCRImport);
router.put('/transaction/ocr/:transactionOCRImportId/confirm', confirmTransactionOCRImportAndCreateTransaction);
router.put('/transaction/ocr/:transactionOCRImportId/reject', rejectTransactionOCRImport);
router.get('/cashflow', getAccountsCashflow);
router.patch('/:accountId', updateAccount);
router.delete('/:accountId', deleteAccount);
router.get('/:accountId/metrics', getAccountMetrics);
router.get('/:accountId/recent-transactions', getRecentTransactions);
router.get('/:accountId/transaction', getAccountTransactions);
router.post('/:accountId/transaction/upload', getS3PresignedUrlForCsvUpload);
router.post('/:accountId/transaction/import/preview', previewAccountCsvImport);
router.post('/:accountId/transaction/import', startAccountCsvImport);
router.post('/:accountId/transaction', createTransaction);
router.get('/:accountId', getAccount);

export default router;
