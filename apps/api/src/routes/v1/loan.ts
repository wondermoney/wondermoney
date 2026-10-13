import express from 'express';

import {
  createLoan,
  deleteLoan,
  deleteLoanRepayment,
  getLoan,
  getLoanOverview,
  getLoanSummary,
  linkLoanRepayment,
  listLoanRepaymentCandidates,
  listLoanRepayments,
  listLoans,
  updateLoan,
  updateLoanRepayment,
} from '@controller/loan';

const router = express.Router();

router.get('/overview', getLoanOverview);
router.get('/', listLoans);
router.post('/', createLoan);
router.get('/:loanId/summary', getLoanSummary);
router.get('/:loanId/repayments', listLoanRepayments);
router.get('/:loanId/repayment-candidates', listLoanRepaymentCandidates);
router.post('/:loanId/repayments/link', linkLoanRepayment);
router.patch('/:loanId/repayments/:repaymentLinkId', updateLoanRepayment);
router.delete('/:loanId/repayments/:repaymentLinkId', deleteLoanRepayment);
router.get('/:loanId', getLoan);
router.patch('/:loanId', updateLoan);
router.delete('/:loanId', deleteLoan);

export default router;
