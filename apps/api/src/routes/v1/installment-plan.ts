import express from 'express';

import {
  deleteInstallmentLink,
  getInstallmentCommitments,
  getInstallmentPlan,
  getInstallmentPlans,
  getInstallmentSuggestions,
  patchInstallmentPlan,
  postInstallmentLink,
  postInstallmentPlan,
  removeInstallmentPlan,
} from '@controller/installment-plan';

const router = express.Router();

router.get('/', getInstallmentPlans);
router.get('/commitments', getInstallmentCommitments);
router.get('/suggestions', getInstallmentSuggestions);
router.post('/', postInstallmentPlan);
router.get('/:installmentPlanId', getInstallmentPlan);
router.patch('/:installmentPlanId', patchInstallmentPlan);
router.delete('/:installmentPlanId', removeInstallmentPlan);
router.post('/:installmentPlanId/installments/:installmentNumber/link', postInstallmentLink);
router.delete('/:installmentPlanId/installments/:installmentNumber/link', deleteInstallmentLink);

export default router;
