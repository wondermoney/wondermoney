import express from 'express';

import {
  createLoan,
  createLoanAdjustment,
  createLoanRatePeriod,
  deleteLoan,
  deleteLoanAdjustment,
  deleteLoanRatePeriod,
  deleteLoanRepayment,
  getLoan,
  getLoanOverview,
  getLoanProjection,
  getLoanSchedule,
  getLoanSummary,
  linkLoanRepayment,
  listLoanAdjustments,
  listLoanRatePeriods,
  listLoanRepaymentCandidates,
  listLoanRepayments,
  listLoans,
  updateLoan,
  updateLoanAdjustment,
  updateLoanRatePeriod,
  updateLoanRepayment,
} from '@controller/loan';

const router = express.Router();

router.get('/overview', getLoanOverview);
router.get('/', listLoans);
router.post('/', createLoan);
router.get('/:loanId/summary', getLoanSummary);
router.get('/:loanId/adjustments', listLoanAdjustments);
router.post('/:loanId/adjustments', createLoanAdjustment);
router.patch('/:loanId/adjustments/:adjustmentId', updateLoanAdjustment);
router.delete('/:loanId/adjustments/:adjustmentId', deleteLoanAdjustment);
router.get('/:loanId/rate-periods', listLoanRatePeriods);
router.post('/:loanId/rate-periods', createLoanRatePeriod);
router.patch('/:loanId/rate-periods/:ratePeriodId', updateLoanRatePeriod);
router.delete('/:loanId/rate-periods/:ratePeriodId', deleteLoanRatePeriod);
router.get('/:loanId/projection', getLoanProjection);
router.get('/:loanId/schedule', getLoanSchedule);
router.get('/:loanId/repayments', listLoanRepayments);
router.get('/:loanId/repayment-candidates', listLoanRepaymentCandidates);
router.post('/:loanId/repayments/link', linkLoanRepayment);
router.patch('/:loanId/repayments/:repaymentLinkId', updateLoanRepayment);
router.delete('/:loanId/repayments/:repaymentLinkId', deleteLoanRepayment);
router.get('/:loanId', getLoan);
router.patch('/:loanId', updateLoan);
router.delete('/:loanId', deleteLoan);

export default router;
