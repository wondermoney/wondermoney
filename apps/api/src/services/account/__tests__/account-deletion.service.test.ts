import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authAdminDeleteUser: vi.fn(),
  captureException: vi.fn(),
  deleteBetterAuthUser: vi.fn(),
  execute: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn(),
  getConnection: vi.fn(),
  getReference: vi.fn(() => ({ appuserKey: 7 })),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  nativeDelete: vi.fn(),
  persist: vi.fn(),
  sendAccountDeletedEmail: vi.fn(),
  transactional: vi.fn(),
}));

vi.mock('@app/database/di', () => ({ DI: { em: { find: mocks.find, findOne: mocks.findOne, flush: mocks.flush, getConnection: () => ({ execute: mocks.execute }), getReference: mocks.getReference, nativeDelete: mocks.nativeDelete, persist: mocks.persist, transactional: mocks.transactional } } }));
vi.mock('@service/auth/better-auth', () => ({ deleteBetterAuthUser: mocks.deleteBetterAuthUser }));
vi.mock('@utils/logger', () => ({ default: { error: mocks.loggerError, info: mocks.loggerInfo } }));
vi.mock('@entity/Appuser', () => ({ Appuser: () => undefined }));
vi.mock('@entity/AppuserTenant', () => ({ AppuserTenant: () => undefined }));
vi.mock('@entity/AssistantConsent', () => ({ AssistantConsent: () => undefined }));
vi.mock('@entity/EmailNotificationPreference', () => ({ EmailNotificationPreference: () => undefined }));
vi.mock('@entity/NordigenRequisition', () => ({ NordigenRequisition: () => undefined }));
vi.mock('@entity/SentEmail', () => ({ SentEmail: () => undefined }));
vi.mock('../../email/email', () => ({ sendAccountDeletedEmail: mocks.sendAccountDeletedEmail }));

import { deleteWonderMoneyAccount } from '../account-deletion.service';

describe('deleteWonderMoneyAccount', () => {
  const now = new Date('2026-07-07T12:00:00.000Z');
  let sentEmailQueryWhere: Record<string, unknown> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    sentEmailQueryWhere = undefined;
    mocks.findOne.mockResolvedValue(null);
    mocks.execute.mockResolvedValue({ appuserKey: 7 });
    mocks.getConnection.mockReturnValue({ execute: mocks.execute });
    mocks.transactional.mockImplementation((cb: (em: typeof mocks) => unknown) => Promise.resolve(cb(mocks)));
  });

  it('deletes local account data and the better-auth identity', async () => {
    const appuser = {
      appuserKey: 7,
      emailAddress: 'real.user@example.com',
      externalUserId: 'better-auth-user-123',
      firstName: 'Real',
      lastName: 'User',
      marketingOptIn: new Date('2026-01-01T00:00:00.000Z'),
      marketingOptOut: undefined,
      mobileNumber: '+351912345678',
      mobileNumberPrefix: '+351',
      recordActive: true,
    };

    const tenantMembership = { appuserTenantKey: 1, deletedAt: null, recordActive: true };
    const requisition = { deletedAt: null, nordigenRequisitionKey: 2, requisitionId: 'req_1' };
    const assistantConsent = { assistantConsentKey: 5, assistantEnabled: true, deletedAt: null, disabledAt: null };
    const retryableSentEmail = { deletedAt: null, sentEmailKey: 6, status: 'failed' };
    const sendingSentEmail = { deletedAt: null, sentEmailKey: 7, status: 'sending' };
    const acceptedFinancialEmail = { deletedAt: null, emailType: 'ba:d:20260718', errorMessage: 'old', metadata: { amount: '100' }, providerMessageIds: ['provider'], providerOutcome: 'accepted', providerRequestStartedAt: now, retryable: false, sentEmailKey: 8, status: 'sent', terminalReason: 'old' };

    mocks.find.mockImplementation((entity: unknown, where: Record<string, unknown>) => {
      const entityName = (entity as { name: string }).name;

      if (entityName === 'AppuserTenant') return Promise.resolve([tenantMembership]);
      if (entityName === 'NordigenRequisition') return Promise.resolve([requisition]);
      if (entityName === 'AssistantConsent') return Promise.resolve([assistantConsent]);
      if (entityName === 'SentEmail') {
        sentEmailQueryWhere = where;
        return Promise.resolve([retryableSentEmail, sendingSentEmail, acceptedFinancialEmail]);
      }

      return Promise.resolve([]);
    });

    const result = deleteWonderMoneyAccount(appuser, {
      authAdmin: { deleteUser: mocks.authAdminDeleteUser },
      now,
      sentry: { captureException: mocks.captureException },
    });

    await expect(result).resolves.toBeUndefined();

    expect(appuser).toMatchObject({
      deletedAt: now,
      emailAddress: 'deleted+7@deleted.invalid',
      externalUserId: 'deleted:7',
      firstName: 'Deleted',
      lastName: 'User',
      marketingOptOut: now,
      mobileNumber: null,
      mobileNumberPrefix: null,
      recordActive: false,
    });
    expect(appuser.marketingOptIn).toBeNull();

    expect(tenantMembership).toMatchObject({ deletedAt: now, recordActive: false });
    expect(requisition).toMatchObject({ deletedAt: now });
    expect(assistantConsent).toMatchObject({ assistantEnabled: false, deletedAt: now, disabledAt: now });
    expect(retryableSentEmail).toMatchObject({ deletedAt: now });
    expect(sendingSentEmail).toMatchObject({ deletedAt: now });
    expect(acceptedFinancialEmail).toMatchObject({ deletedAt: now, errorMessage: undefined, metadata: undefined, providerMessageIds: undefined, providerOutcome: undefined, providerRequestStartedAt: undefined, retryable: false, terminalReason: undefined });

    expect(mocks.authAdminDeleteUser).toHaveBeenCalledWith('better-auth-user-123');
    expect(mocks.sendAccountDeletedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        appuserKey: 7,
        deletedAt: now,
        userEmail: 'real.user@example.com',
      }),
    );
    expect(sentEmailQueryWhere).toMatchObject({ $or: expect.arrayContaining([{ status: { $in: ['sending', 'failed', 'unknown'] } }, { emailType: { $like: 'ba:%' } }, { emailType: { $like: 'wi:%' } }]) });

    expect(mocks.flush).toHaveBeenCalled();
    expect(mocks.nativeDelete).toHaveBeenCalledWith(expect.any(Function), { appuserKey: appuser });
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('for update'), [7], 'get');
  });

  it('awaits each transactional lookup before starting the next one', async () => {
    const appuser = {
      appuserKey: 7,
      emailAddress: 'real.user@example.com',
      externalUserId: 'better-auth-user-123',
      recordActive: true,
    };

    const calls: string[] = [];
    let resolveFirstFind!: (value: unknown[]) => void;

    mocks.find.mockImplementationOnce((entity: unknown) => {
      calls.push((entity as { name: string }).name);
      return new Promise((resolve) => {
        resolveFirstFind = resolve;
      });
    });
    mocks.find.mockImplementation((entity: unknown) => {
      calls.push((entity as { name: string }).name);
      return Promise.resolve([]);
    });

    const result = deleteWonderMoneyAccount(appuser, {
      adminEmail: vi.fn(),
      authAdmin: { deleteUser: mocks.authAdminDeleteUser },
      now,
      sentry: { captureException: mocks.captureException },
    });

    await vi.waitFor(() => {
      expect(calls).toEqual(['AppuserTenant']);
    });

    resolveFirstFind([]);
    await expect(result).resolves.toBeUndefined();
    // RAD-343: owner-deletion teardown adds a Tenant lookup (owned tenants) after the
    // core deletion lookups; no owned tenants in this mock, so no further member finds.
    expect(calls).toEqual(['AppuserTenant', 'NordigenRequisition', 'AssistantConsent', 'SentEmail', 'Tenant']);
  });

  it('logs external cleanup failures but still resolves after deleting the local account', async () => {
    const appuser = {
      appuserKey: 7,
      emailAddress: 'real.user@example.com',
      externalUserId: 'better-auth-user-123',
      marketingOptIn: undefined,
      recordActive: true,
    };

    const tenantMembership = { appuserTenantKey: 1, deletedAt: null, recordActive: true };
    const requisition = { deletedAt: null, nordigenRequisitionKey: 2, requisitionId: 'req_1' };
    const assistantConsent = { assistantConsentKey: 5, assistantEnabled: true, deletedAt: null, disabledAt: null };
    const sentEmail = { deletedAt: null, sentEmailKey: 6, status: 'failed' };

    mocks.find.mockImplementation((entity: unknown, where: Record<string, unknown>) => {
      const entityName = (entity as { name: string }).name;

      if (entityName === 'AppuserTenant') return Promise.resolve([tenantMembership]);
      if (entityName === 'NordigenRequisition') return Promise.resolve([requisition]);
      if (entityName === 'AssistantConsent') return Promise.resolve([assistantConsent]);
      if (entityName === 'SentEmail') {
        sentEmailQueryWhere = where;
        return Promise.resolve([sentEmail]);
      }

      return Promise.resolve([]);
    });
    mocks.authAdminDeleteUser.mockRejectedValueOnce(new Error('better-auth delete down'));

    await expect(
      deleteWonderMoneyAccount(appuser, {
        authAdmin: { deleteUser: mocks.authAdminDeleteUser },
        now,
        sentry: { captureException: mocks.captureException },
      }),
    ).resolves.toBeUndefined();

    expect(appuser).toMatchObject({ deletedAt: now, marketingOptOut: now, recordActive: false });
    expect(appuser.marketingOptIn).toBeNull();
    expect(tenantMembership).toMatchObject({ deletedAt: now, recordActive: false });
    expect(requisition).toMatchObject({ deletedAt: now });
    expect(assistantConsent).toMatchObject({ assistantEnabled: false, deletedAt: now, disabledAt: now });
    expect(sentEmail).toMatchObject({ deletedAt: now });

    expect(mocks.loggerError).toHaveBeenCalled();
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(sentEmailQueryWhere).toMatchObject({ $or: expect.arrayContaining([{ status: { $in: ['sending', 'failed', 'unknown'] } }, { emailType: { $like: 'ba:%' } }, { emailType: { $like: 'wi:%' } }]) });
    expect(mocks.sendAccountDeletedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        appuserKey: 7,
        deletedAt: now,
        userEmail: 'real.user@example.com',
      }),
    );
  });
});
