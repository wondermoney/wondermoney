import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';

const mocked = vi.hoisted(() => ({
  authedContext: vi.fn(),
  createHouseholdInvite: vi.fn(),
  getHousehold: vi.fn(),
  getInviteForValidation: vi.fn(),
  leaveOrRemoveMember: vi.fn(),
  resendHouseholdInvite: vi.fn(),
  revokeHouseholdInvite: vi.fn(),
  zParse: vi.fn(),
}));

vi.mock('@app/app', () => ({ DI: { em: {} } }));
vi.mock('@middleware/authed-context', () => ({ authedContext: mocked.authedContext }));
vi.mock('@service/household/household-invite.service', () => ({
  createHouseholdInvite: mocked.createHouseholdInvite,
  getHousehold: mocked.getHousehold,
  getInviteForValidation: mocked.getInviteForValidation,
  resendHouseholdInvite: mocked.resendHouseholdInvite,
  revokeHouseholdInvite: mocked.revokeHouseholdInvite,
}));
vi.mock('@service/household/household-membership.service', () => ({ leaveOrRemoveMember: mocked.leaveOrRemoveMember }));
vi.mock('@validators/parser', () => ({ zParse: mocked.zParse }));

import {
  createInviteController,
  getHouseholdController,
  removeMemberController,
  resendInviteController,
  revokeInviteController,
  validateInviteController,
} from '../household';

const tenant = { tenantKey: 10 };
const user = { appuserKey: 1, emailAddress: 'owner@example.com' };
const request = { body: {}, params: {}, query: {}, tenant, user } as unknown as Request;

function pendingInvite() {
  return {
    emailAddress: 'partner@example.com',
    expiresAt: new Date('2026-10-05T00:00:00.000Z'),
    householdInviteKey: 21,
    status: 'pending',
    token: 'sensitive-token',
  };
}

function response() {
  const res = { json: vi.fn(), sendStatus: vi.fn(), status: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response & {
    json: ReturnType<typeof vi.fn>;
    sendStatus: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  };
}

describe('household controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.authedContext.mockReturnValue({ tenant, user });
    mocked.zParse.mockResolvedValue({ body: {}, params: {}, query: {} });
  });

  describe('authenticated household mutations', () => {
    it('creates an invite with the authenticated household context and omits the token', async () => {
      const invite = pendingInvite();
      const res = response();
      mocked.zParse.mockResolvedValueOnce({ body: { email: 'partner@example.com' } });
      mocked.createHouseholdInvite.mockResolvedValueOnce(invite);

      await createInviteController(request, res);

      expect(mocked.authedContext).toHaveBeenCalledWith(request);
      expect(mocked.createHouseholdInvite).toHaveBeenCalledWith(expect.anything(), user, tenant, 'partner@example.com');
      expect(res.status).toHaveBeenCalledWith(StatusCodes.CREATED);
      expect(res.json).toHaveBeenCalledWith({
        invite: {
          email: invite.emailAddress,
          expiresAt: invite.expiresAt,
          householdInviteKey: invite.householdInviteKey,
          status: invite.status,
        },
      });
      expect(res.json.mock.calls[0]?.[0]).not.toHaveProperty('invite.token');
    });

    it('returns the household view for an authenticated member', async () => {
      const household = {
        members: [{ appuserKey: 1, emailAddress: user.emailAddress, firstName: 'Owner', role: 'owner' }],
        pendingInvite: { email: 'partner@example.com', expiresAt: new Date('2026-10-05T00:00:00.000Z'), householdInviteKey: 21 },
      };
      const res = response();
      mocked.getHousehold.mockResolvedValueOnce(household);

      await getHouseholdController(request, res);

      expect(mocked.getHousehold).toHaveBeenCalledWith(expect.anything(), tenant);
      expect(res.json).toHaveBeenCalledWith(household);
    });

    it('removes a member using the authenticated requester and validated path id', async () => {
      const res = response();
      mocked.zParse.mockResolvedValueOnce({ params: { appuserKey: 2 } });

      await removeMemberController(request, res);

      expect(mocked.leaveOrRemoveMember).toHaveBeenCalledWith(expect.anything(), tenant, user, 2);
      expect(res.sendStatus).toHaveBeenCalledWith(StatusCodes.OK);
    });

    it('resends an invite with the authenticated household context and omits the token', async () => {
      const invite = pendingInvite();
      const res = response();
      mocked.zParse.mockResolvedValueOnce({ params: { inviteId: 21 } });
      mocked.resendHouseholdInvite.mockResolvedValueOnce(invite);

      await resendInviteController(request, res);

      expect(mocked.resendHouseholdInvite).toHaveBeenCalledWith(expect.anything(), user, tenant, 21);
      expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(res.json).toHaveBeenCalledWith({
        invite: {
          email: invite.emailAddress,
          expiresAt: invite.expiresAt,
          householdInviteKey: invite.householdInviteKey,
          status: invite.status,
        },
      });
      expect(res.json.mock.calls[0]?.[0]).not.toHaveProperty('invite.token');
    });

    it('revokes an invite with the authenticated household context', async () => {
      const res = response();
      mocked.zParse.mockResolvedValueOnce({ params: { inviteId: 21 } });

      await revokeInviteController(request, res);

      expect(mocked.revokeHouseholdInvite).toHaveBeenCalledWith(expect.anything(), tenant, 21);
      expect(res.sendStatus).toHaveBeenCalledWith(StatusCodes.OK);
    });
  });

  describe('public invite validation', () => {
    it('returns only the safe invite preview and does not require authentication', async () => {
      const preview = {
        email: 'partner@example.com',
        expiresAt: new Date('2026-10-05T00:00:00.000Z'),
        inviterName: 'Owner',
      };
      const res = response();
      const publicRequest = { query: { token: 'sensitive-token' } } as unknown as Request;
      mocked.zParse.mockResolvedValueOnce({ query: { token: 'sensitive-token' } });
      mocked.getInviteForValidation.mockResolvedValueOnce(preview);

      await validateInviteController(publicRequest, res);

      expect(mocked.authedContext).not.toHaveBeenCalled();
      expect(mocked.getInviteForValidation).toHaveBeenCalledWith(expect.anything(), 'sensitive-token');
      expect(res.json).toHaveBeenCalledWith(preview);
      expect(res.json.mock.calls[0]?.[0]).not.toHaveProperty('token');
    });
  });

  describe('service error propagation', () => {
    it('propagates a conflict from invite creation with its HTTP status', async () => {
      const error = new ConflictError('This household is full.');
      const res = response();
      mocked.createHouseholdInvite.mockRejectedValueOnce(error);

      await expect(createInviteController(request, res)).rejects.toBe(error);
      expect(error.status).toBe(StatusCodes.CONFLICT);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('propagates a missing-member error with its HTTP status', async () => {
      const error = new NotFoundError('Household member not found');
      const res = response();
      mocked.zParse.mockResolvedValueOnce({ params: { appuserKey: 2 } });
      mocked.leaveOrRemoveMember.mockRejectedValueOnce(error);

      await expect(removeMemberController(request, res)).rejects.toBe(error);
      expect(error.status).toBe(StatusCodes.NOT_FOUND);
      expect(res.sendStatus).not.toHaveBeenCalled();
    });

    it('propagates an invalid public token error with its HTTP status', async () => {
      const error = new BadRequestError('This invitation is invalid or has already been used.');
      const res = response();
      mocked.zParse.mockResolvedValueOnce({ query: { token: 'invalid-token' } });
      mocked.getInviteForValidation.mockRejectedValueOnce(error);

      await expect(validateInviteController({ query: {} } as unknown as Request, res)).rejects.toBe(error);
      expect(error.status).toBe(StatusCodes.BAD_REQUEST);
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
