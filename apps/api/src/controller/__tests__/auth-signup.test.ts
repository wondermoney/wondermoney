import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  consumeInvite: vi.fn(),
  ensureAppuserTenantLink: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn(),
  getOrCreateTenant: vi.fn(),
  getPrimaryAuthProvider: vi.fn(),
  getRepository: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByExternalId: vi.fn(),
  isAppError: vi.fn(),
  loggerError: vi.fn(),
  persist: vi.fn(),
  recordAnalyticsOutboxEvent: vi.fn(),
  recordSignup: vi.fn(),
  sendSignupEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  validateInviteForSignup: vi.fn(),
  zParse: vi.fn(),
}));

vi.mock('@app/app', () => ({
  DI: { em: { findOne: mocked.findOne, flush: mocked.flush, getRepository: mocked.getRepository, persist: mocked.persist } },
}));
vi.mock('@service/auth/auth-callback.service', () => ({
  ensureAppuserTenantLink: mocked.ensureAppuserTenantLink,
  getOrCreateTenant: mocked.getOrCreateTenant,
  isAppError: mocked.isAppError,
}));
vi.mock('@service/auth/auth-callback.utils', () => ({ getAuthUserFullName: vi.fn(() => 'New User') }));
vi.mock('@service/auth/better-auth', () => ({ getPrimaryAuthProvider: mocked.getPrimaryAuthProvider }));
vi.mock('@service/email/email', () => ({
  sendSignupEmail: mocked.sendSignupEmail,
  sendWelcomeEmail: mocked.sendWelcomeEmail,
}));
vi.mock('@service/household/household-invite.service', () => ({
  consumeInvite: mocked.consumeInvite,
  notifyExistingUserInviteAttempt: vi.fn(),
  validateInviteForSignup: mocked.validateInviteForSignup,
}));
vi.mock('@service/analytics/analytics-outbox.service', () => ({ recordAnalyticsOutboxEvent: mocked.recordAnalyticsOutboxEvent }));
vi.mock('@service/auth/signup-record.service', () => ({ recordSignup: mocked.recordSignup }));
vi.mock('@utils/logger', () => ({
  default: { error: mocked.loggerError, info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@validators/parser', () => ({ zParse: mocked.zParse }));

import { AppuserAccountType } from '@entity/Appuser';
import { BadRequestError, ConflictError, ERROR_CODE } from '@utils/errors';

import { authCallback } from '../auth';

const externalUserId = '1f8fab82-1cc1-427b-9f51-5b9fe416bd88';
function makeAppuser() {
  return {
    accountType: AppuserAccountType.REGULAR,
    appuserKey: 42,
    emailAddress: 'new@example.com',
    externalUserId,
    firstName: 'New',
    language: 'en',
    lastName: 'User',
  };
}
let appuser = makeAppuser();
const snapshot = { signupSnapshotKey: 7 };

function makeResponse(): Parameters<typeof authCallback>[1] {
  const response = { json: vi.fn(), status: vi.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Parameters<typeof authCallback>[1];
}

describe('auth callback signup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    appuser = makeAppuser();
    mocked.getRepository.mockReturnValue({
      getUserByEmail: mocked.getUserByEmail,
      getUserByExternalId: mocked.getUserByExternalId,
    });
    mocked.zParse.mockResolvedValue({ body: {} });
    mocked.getUserByExternalId.mockResolvedValue(null);
    mocked.getUserByEmail.mockResolvedValue(null);
    mocked.findOne.mockResolvedValue(null);
    mocked.getPrimaryAuthProvider.mockResolvedValue('email');
    mocked.isAppError.mockReturnValue(false);
    mocked.recordSignup.mockResolvedValue({ appuser, created: true, snapshot });
    mocked.getOrCreateTenant.mockResolvedValue({ tenantKey: 99 });
    mocked.recordAnalyticsOutboxEvent.mockResolvedValue(undefined);
  });

  it('provisions a new signup with its own household and nothing else', async () => {
    const response = makeResponse();

    await authCallback(
      { authUser: { session: { id: 'session-signup' }, user: { email: appuser.emailAddress, id: externalUserId } } } as Parameters<typeof authCallback>[0],
      response,
    );

    expect(mocked.recordSignup).toHaveBeenCalledWith(expect.objectContaining({ email: appuser.emailAddress, externalUserId }));
    expect(mocked.getOrCreateTenant).toHaveBeenCalledWith(expect.anything(), appuser);
    expect(mocked.ensureAppuserTenantLink).toHaveBeenCalledWith(expect.anything(), appuser, { tenantKey: 99 });
    expect(response.json).toHaveBeenCalledWith({ appuserKey: 42, method: 'email', outcome: 'signup' });
  });

  it('reports provisioning failures separately after canonical signup commits', async () => {
    const provisioningError = new Error('tenant unavailable');
    provisioningError.name = externalUserId;
    mocked.getOrCreateTenant.mockRejectedValueOnce(provisioningError);

    const action = authCallback(
      { authUser: { session: { id: 'session-signup' }, user: { email: appuser.emailAddress, id: externalUserId } } } as Parameters<typeof authCallback>[0],
      makeResponse(),
    );

    await expect(action).rejects.toThrow('Post-signup provisioning failed');
    expect(mocked.recordSignup).toHaveBeenCalledOnce();
    expect(mocked.loggerError).toHaveBeenCalledWith(
      { appuserKey: 42, errorType: 'Error', stage: 'tenant' },
      'Auth callback provisioning failed after canonical signup',
    );
    const provisioningLog = mocked.loggerError.mock.calls.find(([, message]) =>
      message === 'Auth callback provisioning failed after canonical signup');
    expect(provisioningLog).not.toEqual(expect.arrayContaining([expect.objectContaining({ error: expect.anything() })]));
    expect(JSON.stringify(provisioningLog)).not.toContain(externalUserId);
    expect(JSON.stringify(provisioningLog)).not.toContain(provisioningError.message);
  });

  it('reports replay provisioning failures against the committed canonical signup', async () => {
    const provisioningError = new Error('replay provisioning unavailable');
    mocked.getUserByExternalId.mockResolvedValueOnce(appuser);
    mocked.findOne.mockResolvedValueOnce(snapshot);
    mocked.getOrCreateTenant.mockRejectedValueOnce(provisioningError);

    const action = authCallback(
      { authUser: { session: { id: 'session-signup' }, user: { email: appuser.emailAddress, id: externalUserId } } } as Parameters<typeof authCallback>[0],
      makeResponse(),
    );

    await expect(action).rejects.toThrow('Post-signup provisioning failed');
    expect(mocked.loggerError).toHaveBeenCalledWith(
      { appuserKey: 42, errorType: 'Error', stage: 'tenant' },
      'Auth callback provisioning failed after canonical signup',
    );
  });

  it('validates and consumes a household invite without provisioning a second tenant', async () => {
    const invite = { householdInviteKey: 17, tenantKey: { tenantKey: 99 } };
    mocked.zParse.mockResolvedValueOnce({ body: { inviteToken: 'invite-token', locale: 'en' } });
    mocked.validateInviteForSignup.mockResolvedValueOnce(invite);
    mocked.consumeInvite.mockResolvedValueOnce(invite.tenantKey);
    const response = makeResponse();

    await authCallback({ authUser: { user: { email: appuser.emailAddress, id: externalUserId  } } } as Parameters<typeof authCallback>[0], response);

    expect(mocked.validateInviteForSignup).toHaveBeenCalledWith(expect.anything(), 'invite-token', appuser.emailAddress);
    expect(mocked.recordSignup).toHaveBeenCalledOnce();
    expect(mocked.consumeInvite).toHaveBeenCalledWith(expect.anything(), invite, appuser);
    expect(mocked.getOrCreateTenant).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({ appuserKey: appuser.appuserKey, method: 'email', outcome: 'signup' });
  });

  it('propagates an invalid invite during signup before creating the account', async () => {
    const error = new BadRequestError('This invitation was sent to a different email address.');
    mocked.zParse.mockResolvedValueOnce({ body: { inviteToken: 'invite-token', locale: 'en' } });
    mocked.validateInviteForSignup.mockRejectedValueOnce(error);
    mocked.isAppError.mockReturnValueOnce(true);

    await expect(authCallback(
      { authUser: { user: { email: appuser.emailAddress, id: externalUserId  } } } as Parameters<typeof authCallback>[0],
      makeResponse(),
    )).rejects.toBe(error);

    expect(error.status).toBe(400);
    expect(mocked.recordSignup).not.toHaveBeenCalled();
    expect(mocked.consumeInvite).not.toHaveBeenCalled();
  });

  it('reports a household that filled up during signup by its own code, not as a server error', async () => {
    const error = new ConflictError('This household is already full.', ERROR_CODE.HOUSEHOLD_FULL);
    mocked.zParse.mockResolvedValueOnce({ body: { inviteToken: 'invite-token', locale: 'en' } });
    mocked.validateInviteForSignup.mockResolvedValueOnce({ householdInviteKey: 17, tenantKey: { tenantKey: 99 } });
    mocked.consumeInvite.mockRejectedValueOnce(error);
    mocked.isAppError.mockReturnValue(true);

    await expect(authCallback(
      { authUser: { user: { email: appuser.emailAddress, id: externalUserId } } } as Parameters<typeof authCallback>[0],
      makeResponse(),
    )).rejects.toMatchObject({ code: ERROR_CODE.HOUSEHOLD_FULL, status: 409 });
    expect(mocked.getOrCreateTenant).not.toHaveBeenCalled();
  });
});
