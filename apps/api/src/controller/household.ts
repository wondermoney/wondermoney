import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { DI } from '@app/app';
import { HouseholdInvite } from '@entity/HouseholdInvite';
import { authedContext } from '@middleware/authed-context';
import {
  createHouseholdInvite,
  getHousehold,
  getInviteForValidation,
  resendHouseholdInvite,
  revokeHouseholdInvite,
} from '@service/household/household-invite.service';
import { leaveOrRemoveMember } from '@service/household/household-membership.service';
import {
  createHouseholdInviteSchema,
  householdInviteIdSchema,
  householdMemberIdSchema,
  validateHouseholdInviteSchema,
} from '@validators/household';
import { zParse } from '@validators/parser';

const serializeInvite = (invite: HouseholdInvite) => ({
  email: invite.emailAddress,
  expiresAt: invite.expiresAt,
  householdInviteKey: invite.householdInviteKey,
  status: invite.status,
});

export async function createInviteController(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    body: { email },
  } = await zParse(createHouseholdInviteSchema, req);
  const invite = await createHouseholdInvite(DI.em, user, tenant, email);
  return res.status(StatusCodes.CREATED).json({ invite: serializeInvite(invite) });
}

export async function getHouseholdController(req: Request, res: Response) {
  const { tenant } = authedContext(req);
  return res.json(await getHousehold(DI.em, tenant));
}

// Owner removes a member, or a member leaves (self). Authorization is in the service.
export async function removeMemberController(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    params: { appuserKey },
  } = await zParse(householdMemberIdSchema, req);
  await leaveOrRemoveMember(DI.em, tenant, user, appuserKey);
  return res.sendStatus(StatusCodes.OK);
}

export async function resendInviteController(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    params: { inviteId },
  } = await zParse(householdInviteIdSchema, req);
  const invite = await resendHouseholdInvite(DI.em, user, tenant, inviteId);
  return res.status(StatusCodes.OK).json({ invite: serializeInvite(invite) });
}

export async function revokeInviteController(req: Request, res: Response) {
  const { tenant } = authedContext(req);
  const {
    params: { inviteId },
  } = await zParse(householdInviteIdSchema, req);
  await revokeHouseholdInvite(DI.em, tenant, inviteId);
  return res.sendStatus(StatusCodes.OK);
}

// Public, pre-signup: the /join page validates the token and shows the invite.
export async function validateInviteController(req: Request, res: Response) {
  const {
    query: { token },
  } = await zParse(validateHouseholdInviteSchema, req);
  return res.json(await getInviteForValidation(DI.em, token));
}
