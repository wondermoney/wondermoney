import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  ensureAppuserTenantLink: vi.fn(),
  getOrCreateTenant: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByExternalId: vi.fn(),
  reconnectLegacyAppuser: vi.fn(),
  recordAnalyticsOutboxEvent: vi.fn(),
  recordSignup: vi.fn(),
  sendReconnectVerificationEmail: vi.fn(),
  zParse: vi.fn(),
}));

vi.mock('@app/app', () => ({
  DI: {
    em: {
      getRepository: vi.fn(() => ({
        getUserByEmail: mocked.getUserByEmail,
        getUserByExternalId: mocked.getUserByExternalId,
      })),
    },
  },
}));
vi.mock('@service/auth/auth-callback.service', () => ({
  ensureAppuserTenantLink: mocked.ensureAppuserTenantLink,
  getOrCreateTenant: mocked.getOrCreateTenant,
  isAppError: (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error),
}));
vi.mock('@service/auth/auth-callback.utils', () => ({ getAuthUserFullName: vi.fn(() => 'Old User') }));
vi.mock('@service/auth/better-auth', () => ({
  betterAuthUserExists: vi.fn(),
  getPrimaryAuthProvider: vi.fn(async () => 'google'),
  sendReconnectVerificationEmail: mocked.sendReconnectVerificationEmail,
}));
vi.mock('@service/auth/legacy-account-reconnect.service', () => ({ reconnectLegacyAppuser: mocked.reconnectLegacyAppuser }));
vi.mock('@service/email/email', () => ({ sendSignupEmail: vi.fn() }));
vi.mock('@service/analytics/analytics-outbox.service', () => ({ recordAnalyticsOutboxEvent: mocked.recordAnalyticsOutboxEvent }));
vi.mock('@service/auth/signup-record.service', () => ({ recordSignup: mocked.recordSignup }));
vi.mock('@validators/parser', () => ({ zParse: mocked.zParse }));

import { AppuserAccountType } from '@entity/Appuser';
import { ERROR_CODE } from '@utils/errors';

import { mockRes } from '../../__tests__/__helpers__/mock-request';
import { authCallback } from '../auth';

/*
 * Someone whose account predates better-auth signs in with a new login carrying the same email.
 */
describe('auth callback for an account from before better-auth', () => {
  const legacyAccount = { accountType: AppuserAccountType.REGULAR, appuserKey: 149, emailAddress: 'old@example.com', externalUserId: 'old-provider-id' };

  function signIn(emailVerified: boolean) {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const req = {
      authUser: { session: { id: 'session-1' }, user: { email: 'old@example.com', emailVerified, id: 'new-login-id' } },
    } as unknown as Parameters<typeof authCallback>[0];
    return { json, run: () => authCallback(req, mockRes({ json, status })) };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.zParse.mockResolvedValue({ body: { locale: 'pt' } });
    mocked.getUserByEmail.mockResolvedValue(legacyAccount);
    mocked.getOrCreateTenant.mockResolvedValue({ tenantKey: 3 });
  });

  it('signs a verified login into the old account instead of creating a new one', async () => {
    // Before the reconnect no account has the new login; after it, the old account does.
    mocked.getUserByExternalId.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...legacyAccount, externalUserId: 'new-login-id' });
    mocked.reconnectLegacyAppuser.mockResolvedValue('reconnected');

    const { json, run } = signIn(true);
    await run();

    expect(json).toHaveBeenCalledWith({ appuserKey: 149, method: 'google', outcome: 'login' });
    expect(mocked.recordSignup).not.toHaveBeenCalled();
  });

  it('emails a verification link to an unverified login and says why it cannot continue yet', async () => {
    mocked.getUserByExternalId.mockResolvedValue(null);
    mocked.reconnectLegacyAppuser.mockResolvedValue('email-unverified');

    const { run } = signIn(false);

    await expect(run()).rejects.toMatchObject({ code: ERROR_CODE.ACCOUNT_RECONNECT_EMAIL_UNVERIFIED, status: 400 });
    expect(mocked.sendReconnectVerificationEmail).toHaveBeenCalledWith('old@example.com', 'pt');
    expect(mocked.recordSignup).not.toHaveBeenCalled();
  });

  it('still refuses when the old account has a working login of its own', async () => {
    mocked.getUserByExternalId.mockResolvedValue(null);
    mocked.reconnectLegacyAppuser.mockResolvedValue('has-login');

    const { run } = signIn(true);

    await expect(run()).rejects.toMatchObject({ status: 400 });
    expect(mocked.sendReconnectVerificationEmail).not.toHaveBeenCalled();
    expect(mocked.recordSignup).not.toHaveBeenCalled();
  });
});
