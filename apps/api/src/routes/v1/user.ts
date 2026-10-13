import express from 'express';

import { getEmailNotificationPreferences, patchEmailNotificationPreferences } from '@controller/email-notifications';
import { deleteEnableBankingCredential, getEnableBankingCredential, saveEnableBankingCredential } from '@controller/enable-banking-credential';
import { completeOnboarding, getOnboardingBootstrap } from '@controller/onboarding';
import {
  completeMfaReenrollment,
  completeOnboardingStep,
  deleteCurrentUserAccount,
  getCurrentUserProfile,
  getOnboarding,
  getRequisition,
  getRequisitions,
  getUserAccountInformation,
  updateData,
} from '@controller/user';

const router = express.Router();

router.delete('/me', deleteCurrentUserAccount);
router.get('/me/profile', getCurrentUserProfile);
router.get('/me/email-notification-preferences', getEmailNotificationPreferences);
router.patch('/me/email-notification-preferences', patchEmailNotificationPreferences);
router.get('/me/onboarding', getOnboardingBootstrap);
router.post('/me/onboarding/complete', completeOnboarding);
// Registered before `/:userId` (single path segment, would otherwise shadow it) —
// same reasoning as `/me/profile` above.
router.post('/enable-banking-credential', saveEnableBankingCredential);
router.get('/enable-banking-credential', getEnableBankingCredential);
router.delete('/enable-banking-credential', deleteEnableBankingCredential);
router.get('/:userId', getUserAccountInformation);
router.patch('/:userId', updateData);
router.get('/:userId/requisitions', getRequisitions);
router.get('/:userId/requisition/:requisitionId', getRequisition);
router.get('/:userId/onboarding', getOnboarding);
router.post('/:userId/onboarding/:step/complete', completeOnboardingStep);
router.post('/:userId/mfa-reenrollment/complete', completeMfaReenrollment);

export default router;
