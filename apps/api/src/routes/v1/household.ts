import express from 'express';

import {
  createInviteController,
  getHouseholdController,
  removeMemberController,
  resendInviteController,
  revokeInviteController,
} from '@controller/household';
import { requireHouseholdOwner } from '@middleware/household';

const router = express.Router();

// Any member can view the household; only the owner can manage invites.
router.get('/', getHouseholdController);
router.post('/invites', requireHouseholdOwner, createInviteController);
router.delete('/invites/:inviteId', requireHouseholdOwner, revokeInviteController);
router.post('/invites/:inviteId/resend', requireHouseholdOwner, resendInviteController);
// Remove a member (owner) or leave (self). Authorization is enforced in the service.
router.delete('/members/:appuserKey', removeMemberController);

export default router;
