import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  ensureAppuserTenantLink: vi.fn(),
  findOne: vi.fn(),
  getOrCreateTenant: vi.fn(),
  getPrimaryAuthProvider: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByExternalId: vi.fn(),
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
vi.mock('@service/analytics/analytics-outbox.service', () => ({ recordAnalyticsOutboxEvent: vi.fn() }));
vi.mock('@service/email/email', () => ({
  sendSignupEmail: mocked.sendSignupEmail,
  sendWelcomeEmail: mocked.sendWelcomeEmail,
}));
vi.mock('@service/auth/signup-record.service', () => ({ recordSignup: mocked.recordSignup }));
vi.mock('@validators/parser', () => ({ zParse: mocked.zParse }));

import { SupportedLanguages } from '@entity/Appuser';

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

function makeResponse() {
  const json = vi.fn();
  const status = vi.fn();
  status.mockReturnValue({ json });
  return { json, res: mockRes({ json, status }), status };
}

describe('auth callback locale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.findOne.mockResolvedValue(null);
    mocked.getPrimaryAuthProvider.mockResolvedValue('email');
  });

  it('sends a Portuguese signup its email in Portuguese', async () => {
    // Given
    const appuser = { appuserKey: 22, emailAddress: 'pt@example.com', externalUserId: '77d891f2-b0b7-4da9-b82e-ac0fea2a2ed9', firstName: 'Demo', language: SupportedLanguages.PT, lastName: 'User' };
    mocked.zParse.mockResolvedValueOnce({ body: { locale: 'pt' } });
    mocked.getUserByExternalId.mockResolvedValueOnce(null);
    mocked.getUserByEmail.mockResolvedValueOnce(null);
    mocked.recordSignup.mockResolvedValueOnce({ appuser, created: true });
    mocked.getOrCreateTenant.mockResolvedValueOnce({ tenantKey: 6 });

    // When
    await authCallback(makeAuthUser(appuser.externalUserId, appuser.emailAddress), makeResponse().res);

    // Then
    expect(mocked.recordSignup).toHaveBeenCalledWith(expect.objectContaining({ language: SupportedLanguages.PT }));
    expect(mocked.sendSignupEmail).toHaveBeenCalledWith(expect.anything(), SupportedLanguages.PT);
  });

  it.each(['en', 'es'] as const)('maps %s OAuth signup to English email', async (locale) => {
    // Given
    const appuser = { appuserKey: 23, emailAddress: `${locale}@example.com`, externalUserId: '017e067c-7e26-4711-b72e-efb5546d59ac', firstName: 'Demo', language: SupportedLanguages.EN, lastName: 'User' };
    mocked.zParse.mockResolvedValueOnce({ body: { locale } });
    mocked.getUserByExternalId.mockResolvedValueOnce(null);
    mocked.getUserByEmail.mockResolvedValueOnce(null);
    mocked.recordSignup.mockResolvedValueOnce({ appuser, created: true });
    mocked.getOrCreateTenant.mockResolvedValueOnce({ tenantKey: 7 });
    mocked.getPrimaryAuthProvider.mockResolvedValueOnce('google');

    // When
    await authCallback(makeAuthUser(appuser.externalUserId, appuser.emailAddress), makeResponse().res);

    // Then
    expect(mocked.recordSignup).toHaveBeenCalledWith(expect.objectContaining({ language: SupportedLanguages.EN, method: 'google' }));
  });
});
