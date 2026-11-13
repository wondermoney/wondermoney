import express from 'express';

import {
  acceptInviteController,
  changeMemberRoleController,
  createInviteController,
  getHouseholdController,
  removeMemberController,
  resendInviteController,
  revokeInviteController,
  transferOwnershipController,
} from '@controller/household';
import { requireHouseholdManager, requireHouseholdOwner } from '@middleware/household';

const router = express.Router();

// Everyone in the household can view it; owners and admins manage invites and roles (whom they
// may act on is checked in the service), and only the owner hands the household on.
router.get('/', getHouseholdController);
router.post('/invites', requireHouseholdManager, createInviteController);
router.delete('/invites/:inviteId', requireHouseholdManager, revokeInviteController);
router.post('/invites/:inviteId/resend', requireHouseholdManager, resendInviteController);
// A signed-in, existing user confirms joining the household that invited them.
router.post('/invites/:token/accept', acceptInviteController);
router.patch('/members/:appuserKey', requireHouseholdManager, changeMemberRoleController);
// Remove a member (owner or admin) or leave (self). Authorization is enforced in the service.
router.delete('/members/:appuserKey', removeMemberController);
router.post('/transfer-ownership', requireHouseholdOwner, transferOwnershipController);

export default router;
