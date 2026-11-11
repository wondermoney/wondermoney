import express from 'express';

import { createApiTokenController, listApiTokens, revokeApiToken } from '@controller/api-token';
import { downloadDataExport, getDataExport, listDataExports, startDataExport } from '@controller/data-export';
import { commitDataRestore, getDataRestore, listDataRestores, startDataRestore, validateDataRestore } from '@controller/data-restore';
import { getEmailNotificationPreferences, patchEmailNotificationPreferences } from '@controller/email-notifications';
import { deleteEnableBankingCredential, getEnableBankingCredential, saveEnableBankingCredential } from '@controller/enable-banking-credential';
import { completeOnboarding, getOnboardingBootstrap } from '@controller/onboarding';
import {
  completeOnboardingStep,
  deleteCurrentUserAccount,
  getCurrentUserProfile,
  getOnboarding,
  getRequisition,
  getRequisitions,
  getUserAccountInformation,
  updateData,
} from '@controller/user';
import { getPreferences, patchPreferences } from '@controller/user-preferences';
import { dataExportRateLimit, dataRestoreRateLimit } from '@middleware/rate-limit';
import { requireSensitiveSession } from '@middleware/sensitive-session';

const router = express.Router();

router.delete('/me', deleteCurrentUserAccount);
router.get('/me/profile', getCurrentUserProfile);
// Personal API tokens. Registered before `/:userId` (single path segment, would otherwise
// shadow it). Tokens themselves can never reach this mount: the API-token scope allowlist
// excludes `/v1/user`, and `requireSensitiveSession` rejects a token bearer explicitly.
router.get('/api-tokens', listApiTokens);
router.post('/api-tokens', requireSensitiveSession, createApiTokenController);
router.delete('/api-tokens/:id', revokeApiToken);
router.get('/me/email-notification-preferences', getEmailNotificationPreferences);
router.patch('/me/email-notification-preferences', patchEmailNotificationPreferences);
router.get('/me/preferences', getPreferences);
router.patch('/me/preferences', patchPreferences);
router.get('/me/onboarding', getOnboardingBootstrap);
router.get('/me/exports', listDataExports);
router.post('/me/exports', dataExportRateLimit(), startDataExport);
router.get('/me/exports/:exportId', getDataExport);
router.get('/me/exports/:exportId/download', dataExportRateLimit(), downloadDataExport);
router.get('/me/restores', listDataRestores);
router.post('/me/restores', dataRestoreRateLimit(), startDataRestore);
router.get('/me/restores/:restoreId', getDataRestore);
router.post('/me/restores/:restoreId/validate', dataRestoreRateLimit(), validateDataRestore);
router.post('/me/restores/:restoreId/commit', dataRestoreRateLimit(), commitDataRestore);
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

export default router;
