import apicache from 'apicache';
import express from 'express';

import {
  confirmTransactionAttachment,
  confirmTransactionOCRImportAndCreateTransaction,
  createOfflineAccount,
  createTransaction,
  createTransactionAttachmentUploadUrl,
  createTransactionOCRImport,
  deleteAccount,
  deleteTransaction,
  deleteTransactionAttachment,
  deleteTransactions,
  getAccount,
  getAccountFinancialInstitutions,
  getAccountMetrics,
  getAccounts,
  getAccountsCashflow,
  getAccountsForecast,
  getAccountSharesController,
  getAccountsMetrics,
  getAccountTransactions,
  getAccountTypes,
  getCategorySpending,
  getCurrencies,
  getRecentTransactions,
  getS3PresignedUrlForCsvUpload,
  getTransactionAttachments,
  getTransactionHistory,
  getTransactionMerchantLogo,
  getTransactionMerchants,
  getTransactionReviewSummary,
  getTransactions,
  getTransactionTypes,
  previewAccountCsvImport,
  putAccountSharesController,
  recalculateAccount,
  rejectTransactionOCRImport,
  reorderAccounts,
  startAccountCsvImport,
  updateAccount,
  updateTransaction,
  updateTransactionMerchant,
  updateTransactions,
} from '@controller/account';
import { getCreditCardStatementDetailHandler, getCreditCardStatementsHandler, putCreditCardSettings } from '@controller/account/credit-card';
import { setTransactionTags } from '@controller/tag';
import { getReimbursementSuggestions, getTransactionReimbursements, linkReimbursement, unlinkReimbursement } from '@controller/transaction-reimbursement';
import { removeTransactionSplits, setTransactionSplits } from '@controller/transaction-split';
import { requireWritableAccount, requireWritableTransaction } from '@middleware/account-access';
import { requireAiAllowance } from '@middleware/ai-allowance';
import { requireAiAllowed } from '@middleware/ai-enabled';
import { requireVerifiedEmailForAi } from '@middleware/email-verification';
import multerSingleFile from '@middleware/multer';

const cache = apicache.middleware;
const router = express.Router();

router.get('/', getAccounts);
router.put('/order', reorderAccounts);
router.post('/offline', createOfflineAccount);
router.get('/transaction/category-spending', getCategorySpending);
router.get('/transaction/review-summary', getTransactionReviewSummary);
router.patch('/transaction', updateTransactions);
router.delete('/transaction', deleteTransactions);
router.patch('/transaction/:transactionId', requireWritableTransaction, updateTransaction);
router.delete('/transaction/:transactionId', requireWritableTransaction, deleteTransaction);
router.get('/transaction/:transactionId/history', getTransactionHistory);
router.put('/transaction/:transactionId/tags', requireWritableTransaction, setTransactionTags);
router.put('/transaction/:transactionId/splits', requireWritableTransaction, setTransactionSplits);
router.delete('/transaction/:transactionId/splits', requireWritableTransaction, removeTransactionSplits);
router.get('/transaction/:transactionId/reimbursements/suggestions', getReimbursementSuggestions);
router.get('/transaction/:transactionId/reimbursements', getTransactionReimbursements);
router.post('/transaction/:transactionId/reimbursements', requireWritableTransaction, linkReimbursement);
router.delete('/transaction/:transactionId/reimbursements/:reimbursementId', requireWritableTransaction, unlinkReimbursement);
router.get('/transaction', getTransactions);
router.get('/metrics', getAccountsMetrics);
router.get('/currencies', cache('1 day'), getCurrencies);
router.get('/transaction-types', cache('1 day'), getTransactionTypes);
router.get('/transaction-merchants', getTransactionMerchants);
router.patch('/transaction-merchants/:merchantId', updateTransactionMerchant);
router.get('/transaction-merchants/:merchantId/logo', getTransactionMerchantLogo);
router.get('/financial-institutions', cache('1 day'), getAccountFinancialInstitutions);
router.get('/account-types', cache('1 day'), getAccountTypes);
router.post('/transaction/ocr', requireVerifiedEmailForAi, requireAiAllowed('ocr'), requireAiAllowance('ocr'), multerSingleFile, createTransactionOCRImport);
router.put('/transaction/ocr/:transactionOCRImportId/confirm', confirmTransactionOCRImportAndCreateTransaction);
router.put('/transaction/ocr/:transactionOCRImportId/reject', rejectTransactionOCRImport);
router.post('/transaction/:transactionId/attachments/upload-url', requireWritableTransaction, createTransactionAttachmentUploadUrl);
router.post('/transaction/:transactionId/attachments', requireWritableTransaction, confirmTransactionAttachment);
router.get('/transaction/:transactionId/attachments', getTransactionAttachments);
router.delete('/transaction/:transactionId/attachments/:attachmentId', requireWritableTransaction, deleteTransactionAttachment);
router.get('/cashflow', getAccountsCashflow);
router.get('/forecast', getAccountsForecast);
router.patch('/:accountId', requireWritableAccount, updateAccount);
router.delete('/:accountId', requireWritableAccount, deleteAccount);
router.get('/:accountId/metrics', getAccountMetrics);
router.put('/:accountId/credit-card', requireWritableAccount, putCreditCardSettings);
router.get('/:accountId/statements', getCreditCardStatementsHandler);
router.get('/:accountId/statements/:statementDate', getCreditCardStatementDetailHandler);
router.get('/:accountId/shares', getAccountSharesController);
router.put('/:accountId/shares', putAccountSharesController);
router.post('/:accountId/recalculate', requireWritableAccount, recalculateAccount);
router.get('/:accountId/recent-transactions', getRecentTransactions);
router.get('/:accountId/transaction', getAccountTransactions);
router.post('/:accountId/transaction/upload', requireWritableAccount, getS3PresignedUrlForCsvUpload);
router.post('/:accountId/transaction/import/preview', requireWritableAccount, previewAccountCsvImport);
router.post('/:accountId/transaction/import', requireWritableAccount, startAccountCsvImport);
router.post('/:accountId/transaction', requireWritableAccount, createTransaction);
router.get('/:accountId', getAccount);

export default router;
