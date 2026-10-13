import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  ensureAppuserTenantLink: vi.fn(),
  findOne: vi.fn(),
  getOrCreateTenant: vi.fn(),
  getPrimaryAuthProvider: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByExternalId: vi.fn(),
  recordAnalyticsOutboxEvent: vi.fn(),
  recordSignup: vi.fn(),
  sendSignupEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  zParse: vi.fn(),
}));

vi.mock('@app/app', () => ({
  DI: {
    em: {
      findOne: mocked.findOne,
      getRepository: vi.fn(() => ({
        getUserByEmail: mocked.getUserByEmail,
        getUserByExternalId: mocked.getUserByExternalId,
      })),
      persist: vi.fn().mockReturnThis(),
      upsert: vi.fn(),
    },
  },
}));
vi.mock('@service/auth/auth-callback.service', () => ({
  ensureAppuserTenantLink: mocked.ensureAppuserTenantLink,
  getOrCreateTenant: mocked.getOrCreateTenant,
  isAppError: (error: unknown) => Boolean(error && typeof error === 'object' && 'message' in error),
}));
vi.mock('@service/auth/auth-callback.utils', () => ({ getAuthUserFullName: vi.fn(() => 'Demo User') }));
vi.mock('@service/auth/better-auth', () => ({ getPrimaryAuthProvider: mocked.getPrimaryAuthProvider }));
vi.mock('@service/email/email', () => ({
  sendSignupEmail: mocked.sendSignupEmail,
  sendWelcomeEmail: mocked.sendWelcomeEmail,
}));
vi.mock('@service/analytics/analytics-outbox.service', () => ({ recordAnalyticsOutboxEvent: mocked.recordAnalyticsOutboxEvent }));
vi.mock('@service/auth/signup-record.service', () => ({ recordSignup: mocked.recordSignup }));
vi.mock('@validators/parser', () => ({ zParse: mocked.zParse }));

import { AppuserAccountType, SupportedLanguages } from '@entity/Appuser';

import { mockRes } from '../../__tests__/__helpers__/mock-request';
import { authCallback } from '../auth';

function makeAuthUser(id: string, email: string, sessionId?: string): Parameters<typeof authCallback>[0] {
  return {
    authUser: {
      session: { id: sessionId ?? 'session-default' },
      user: { email, id },
    },
  } as unknown as Parameters<typeof authCallback>[0];
}

describe('auth callback', () => {
  const makeRes = () => {
    const json = vi.fn();
    const sendStatus = vi.fn();
    const status = vi.fn();
    status.mockReturnValue({ json });
    return { json, res: mockRes({ json, sendStatus, status }), sendStatus, status };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.zParse.mockResolvedValue({
      body: { locale: 'en' },
    });
    mocked.findOne.mockResolvedValue(null);
    mocked.getPrimaryAuthProvider.mockResolvedValue('email');
    mocked.recordAnalyticsOutboxEvent.mockResolvedValue(undefined);
  });

  it('defaults a new signup callback to English when route context is absent', async () => {
    // Given: the email callback carries no locale
    const appuser = {
      appuserKey: 21,
      emailAddress: 'new@example.com',
      externalUserId: '279b6e90-6b64-420b-b039-038d62bd5168',
      firstName: 'Demo',
      language: SupportedLanguages.EN,
      lastName: 'User',
    };
    mocked.getUserByExternalId.mockResolvedValueOnce(null);
    mocked.getUserByEmail.mockResolvedValueOnce(null);
    mocked.recordSignup.mockResolvedValueOnce({
      appuser,
      created: true,
    });
    mocked.getOrCreateTenant.mockResolvedValueOnce({ tenantKey: 5 });

    // When: the callback provisions the new account
    const res = makeRes();
    await authCallback(
      makeAuthUser(appuser.externalUserId, appuser.emailAddress),
      res.res,
    );

    // Then: the existing default is explicitly characterized before extending it
    expect(mocked.recordSignup).toHaveBeenCalledWith(expect.objectContaining({
      email: appuser.emailAddress,
      externalUserId: appuser.externalUserId,
      language: SupportedLanguages.EN,
      method: 'email',
    }));
    expect(res.json).toHaveBeenCalledWith({ appuserKey: 21, method: 'email', outcome: 'signup' });
  });

  it('returns early for demo existing-user logins and tracks login with the auth session identity without provider calls', async () => {
    const existingUser = { accountType: AppuserAccountType.DEMO, appuserKey: 7, emailAddress: 'demo@wonder.money' };
    mocked.getUserByExternalId.mockResolvedValueOnce(existingUser);

    const res = makeRes();

    await authCallback(makeAuthUser('supabase-id', 'demo@wonder.money', 'session-demo'), res.res);

    expect(mocked.getOrCreateTenant).not.toHaveBeenCalled();
    expect(mocked.ensureAppuserTenantLink).not.toHaveBeenCalled();
    expect(mocked.recordAnalyticsOutboxEvent).toHaveBeenCalledWith(expect.anything(), {
      distinctId: 'supabase-id',
      eventId: 'login.v1:session-demo',
      eventName: 'login',
      properties: expect.objectContaining({ appuser_key: '7' }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ appuserKey: 7, method: 'email', outcome: 'demo' });
  });

  it('returns early for legacy demo email existing-user logins without writes or provider calls', async () => {
    const existingUser = { accountType: AppuserAccountType.REGULAR, appuserKey: 8, emailAddress: 'demo@wonder.money' };
    mocked.getUserByExternalId.mockResolvedValueOnce(existingUser);

    const res = makeRes();

    await authCallback(makeAuthUser('supabase-id', 'demo@wonder.money', 'session-legacy-demo'), res.res);

    expect(mocked.getOrCreateTenant).not.toHaveBeenCalled();
    expect(mocked.ensureAppuserTenantLink).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ appuserKey: 8, method: 'email', outcome: 'demo' });
  });

  it('returns early for demo email matches after external-id miss without writes or provider calls', async () => {
    const existingUser = { accountType: AppuserAccountType.DEMO, appuserKey: 9, emailAddress: 'demo@wonder.money' };
    mocked.getUserByExternalId.mockResolvedValueOnce(null);
    mocked.getUserByEmail.mockResolvedValueOnce(existingUser);

    const res = makeRes();

    await authCallback(makeAuthUser('supabase-id', 'demo@wonder.money'), res.res);

    expect(mocked.getOrCreateTenant).not.toHaveBeenCalled();
    expect(mocked.ensureAppuserTenantLink).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ appuserKey: 9, method: 'email', outcome: 'demo' });
  });

  it('uses the primary auth provider for login analytics and response', async () => {
    const existingUser = { accountType: AppuserAccountType.REGULAR, appuserKey: 12, emailAddress: 'provider@example.com' };
    mocked.getUserByExternalId.mockResolvedValueOnce(existingUser);
    mocked.getPrimaryAuthProvider.mockResolvedValueOnce('google');

    const res = makeRes();

    await authCallback(
      makeAuthUser('supabase-provider', 'provider@example.com', 'session-provider'),
      res.res,
    );

    expect(mocked.getPrimaryAuthProvider).toHaveBeenCalledWith('supabase-provider');
    expect(mocked.recordAnalyticsOutboxEvent).toHaveBeenCalledWith(expect.anything(), {
      distinctId: 'supabase-provider',
      eventId: 'login.v1:session-provider',
      eventName: 'login',
      properties: expect.objectContaining({ appuser_key: '12', method: 'google' }),
    });
    expect(res.json).toHaveBeenCalledWith({ appuserKey: 12, method: 'google', outcome: 'login' });
  });

  it('falls back to email when the primary auth provider is a credential account', async () => {
    const existingUser = { accountType: AppuserAccountType.REGULAR, appuserKey: 13, emailAddress: 'broken@example.com' };
    mocked.getUserByExternalId.mockResolvedValueOnce(existingUser);
    mocked.getPrimaryAuthProvider.mockResolvedValueOnce('email');

    const res = makeRes();

    await expect(
      authCallback(
        makeAuthUser('supabase-broken', 'broken@example.com', 'session-broken'),
        res.res,
      ),
    ).resolves.toBeUndefined();

    expect(mocked.recordAnalyticsOutboxEvent).toHaveBeenCalledWith(expect.anything(), {
      distinctId: 'supabase-broken',
      eventId: 'login.v1:session-broken',
      eventName: 'login',
      properties: expect.objectContaining({ appuser_key: '13', method: 'email' }),
    });
    expect(res.json).toHaveBeenCalledWith({ appuserKey: 13, method: 'email', outcome: 'login' });
  });
});
