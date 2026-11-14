import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { DI } from '@app/app';
import { HouseholdInvite } from '@entity/HouseholdInvite';
import { authedContext } from '@middleware/authed-context';
import {
  acceptInviteAsExistingUser,
  createHouseholdInvite,
  getHousehold,
  getInviteForValidation,
  resendHouseholdInvite,
  revokeHouseholdInvite,
} from '@service/household/household-invite.service';
import { changeMemberRole, leaveOrRemoveMember, transferOwnership } from '@service/household/household-membership.service';
import {
  acceptHouseholdInviteSchema,
  changeHouseholdMemberRoleSchema,
  createHouseholdInviteSchema,
  householdInviteIdSchema,
  householdMemberIdSchema,
  transferHouseholdOwnershipSchema,
  validateHouseholdInviteSchema,
} from '@validators/household';
import { zParse } from '@validators/parser';

const serializeInvite = (invite: HouseholdInvite) => ({
  email: invite.emailAddress,
  expiresAt: invite.expiresAt,
  householdInviteKey: invite.householdInviteKey,
  role: invite.role,
  status: invite.status,
});

// A signed-in user joins the household that invited them, after confirming on the /join screen.
export async function acceptInviteController(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    params: { token },
  } = await zParse(acceptHouseholdInviteSchema, req);
  await acceptInviteAsExistingUser(DI.em, user, tenant, token);
  return res.sendStatus(StatusCodes.OK);
}

export async function changeMemberRoleController(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    body: { role },
    params: { appuserKey },
  } = await zParse(changeHouseholdMemberRoleSchema, req);
  const member = await changeMemberRole(DI.em, tenant, user, req.householdRole, appuserKey, role);
  return res.json({ member });
}

export async function createInviteController(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    body: { email, role },
  } = await zParse(createHouseholdInviteSchema, req);
  const invite = await createHouseholdInvite(DI.em, user, req.householdRole, tenant, email, role);
  return res.status(StatusCodes.CREATED).json({ invite: serializeInvite(invite) });
}

export async function getHouseholdController(req: Request, res: Response) {
  const { appuserKey, tenant } = authedContext(req);
  return res.json(await getHousehold(DI.em, tenant, appuserKey));
}

// A manager removes a member below them, or a member leaves (self). Authorization is in the service.
export async function removeMemberController(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    params: { appuserKey },
  } = await zParse(householdMemberIdSchema, req);
  await leaveOrRemoveMember(DI.em, tenant, user, req.householdRole, appuserKey);
  return res.sendStatus(StatusCodes.OK);
}

export async function resendInviteController(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    params: { inviteId },
  } = await zParse(householdInviteIdSchema, req);
  const invite = await resendHouseholdInvite(DI.em, user, req.householdRole, tenant, inviteId);
  return res.status(StatusCodes.OK).json({ invite: serializeInvite(invite) });
}

export async function revokeInviteController(req: Request, res: Response) {
  const { tenant } = authedContext(req);
  const {
    params: { inviteId },
  } = await zParse(householdInviteIdSchema, req);
  await revokeHouseholdInvite(DI.em, tenant, req.householdRole, inviteId);
  return res.sendStatus(StatusCodes.OK);
}

// The owner hands the household to another member and stays as admin. Answers the new household view.
export async function transferOwnershipController(req: Request, res: Response) {
  const { appuserKey: viewerAppuserKey, tenant, user } = authedContext(req);
  const {
    body: { appuserKey },
  } = await zParse(transferHouseholdOwnershipSchema, req);
  await transferOwnership(DI.em, tenant, user, appuserKey);
  return res.json(await getHousehold(DI.em, tenant, viewerAppuserKey));
}

// Public, pre-signup: the /join page validates the token and shows the invite.
export async function validateInviteController(req: Request, res: Response) {
  const {
    query: { token },
  } = await zParse(validateHouseholdInviteSchema, req);
  return res.json(await getInviteForValidation(DI.em, token));
}
