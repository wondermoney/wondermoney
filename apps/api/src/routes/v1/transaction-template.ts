import express from 'express';

import {
  createTransactionTemplate,
  deleteTransactionTemplate,
  listTransactionTemplates,
  updateTransactionTemplate,
} from '@controller/transaction-template';

const router = express.Router();

router.get('/', listTransactionTemplates);
router.post('/', createTransactionTemplate);
router.patch('/:transactionTemplateId', updateTransactionTemplate);
router.delete('/:transactionTemplateId', deleteTransactionTemplate);

export default router;
