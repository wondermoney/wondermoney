import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockEm } from '@app/__tests__/__helpers__/mock-em';
import { Appuser, SupportedLanguages } from '@entity/Appuser';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { BadRequestError } from '@utils/errors';

import { EMAIL_NOTIFICATION_PREFERENCE_ERROR, EmailNotificationPreferenceService } from '../email-notification-preference.service';

const eligibleUser = () => Object.assign(new Appuser(), {
  appuserKey: 7,
  emailAddress: 'user@example.com',
  language: SupportedLanguages.PT,
  recordActive: true,
});

const freshRow = (overrides: Record<string, unknown> = {}) => ({
  appuserKey: 7,
  budgetAlertsEnabled: null,
  currencyCode: 'EUR',
  deletedAt: null,
  emailAddress: 'fresh@example.com',
  firstName: 'Fresh',
  language: SupportedLanguages.PT,
  marketingOptOut: null,
  monthlyStoryEnabled: null,
  recordActive: true,
  weeklyInsightsEnabled: null,
  ...overrides,
});

describe('EmailNotificationPreferenceService', () => {
  const execute = vi.fn();
  const findOne = vi.fn();
  const em = Object.assign(mockEm(), { findOne, getConnection: () => ({ execute }), transactional: (callback: (tx: unknown) => unknown) => callback(em) });
  const service = new EmailNotificationPreferenceService(em);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats a missing preference row as opted-in by default', async () => {
    findOne.mockImplementation((entity: unknown) => Promise.resolve(entity === Appuser ? eligibleUser() : null));

    await expect(service.getForAppuser(7)).resolves.toEqual({
      accountRecovery: { effectiveEnabled: true, storedEnabled: true },
      budgetAlerts: { deliverySupported: true, effectiveEnabled: true, storedEnabled: true },
      growth: { effectiveEnabled: true, storedEnabled: true },
      marketingOptOut: false,
      monthlyStory: { deliverySupported: true, effectiveEnabled: true, storedEnabled: true },
      weeklyInsights: { deliverySupported: true, effectiveEnabled: true, storedEnabled: true },
    });
    expect(findOne).toHaveBeenCalledWith(EmailNotificationPreference, { appuserKey: expect.any(Appuser), deletedAt: null });
  });

  it('reads the new categories and the honours explicit opt-outs, including the global one', async () => {
    const preference = Object.assign(new EmailNotificationPreference(), { accountRecoveryEnabled: false, growthEmailsEnabled: true });
    findOne.mockImplementation((entity: unknown) => Promise.resolve(entity === Appuser ? Object.assign(eligibleUser(), { marketingOptOut: new Date('2026-01-01') }) : preference));

    await expect(service.getForAppuser(7)).resolves.toMatchObject({
      accountRecovery: { effectiveEnabled: false, storedEnabled: false },
      growth: { effectiveEnabled: false, storedEnabled: true },
      marketingOptOut: true,
    });
  });

  it('honours an explicitly disabled stream', async () => {
    const preference = Object.assign(new EmailNotificationPreference(), { budgetAlertsEnabled: false, weeklyInsightsEnabled: true });
    findOne.mockImplementation((entity: unknown) => Promise.resolve(entity === Appuser ? eligibleUser() : preference));

    await expect(service.getForAppuser(7)).resolves.toMatchObject({
      budgetAlerts: { effectiveEnabled: false, storedEnabled: false },
      weeklyInsights: { effectiveEnabled: true, storedEnabled: true },
    });
  });

  it('reads fresh worker eligibility from one raw query without ORM identity-map reuse', async () => {
    execute.mockResolvedValue(freshRow({ budgetAlertsEnabled: true }));
    await expect(service.getFreshWorkerEligibility(7, 'budgetAlerts')).resolves.toMatchObject({ effectiveEnabled: true, emailAddress: 'fresh@example.com', storedEnabled: true });
    expect(findOne).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('treats a missing preference row as enabled but honours an explicit opt-out', async () => {
    execute.mockResolvedValue(freshRow());
    await expect(service.getFreshWorkerEligibility(7, 'budgetAlerts')).resolves.toMatchObject({ effectiveEnabled: true, storedEnabled: true });

    execute.mockResolvedValue(freshRow({ budgetAlertsEnabled: false }));
    await expect(service.getFreshWorkerEligibility(7, 'budgetAlerts')).resolves.toMatchObject({ effectiveEnabled: false, storedEnabled: false });
  });

  it('defaults monthlyStory to enabled when no preference row exists', async () => {
    execute.mockResolvedValue(freshRow());
    await expect(service.getFreshWorkerEligibility(7, 'monthlyStory')).resolves.toMatchObject({ effectiveEnabled: true, storedEnabled: true });
  });

  it('reports stored enabled but effectively disabled when delivery is unsupported (invalid email)', async () => {
    execute.mockResolvedValue(freshRow({ budgetAlertsEnabled: true, emailAddress: 'not-an-email' }));
    await expect(service.getFreshWorkerEligibility(7, 'budgetAlerts')).resolves.toMatchObject({ deliverySupported: false, effectiveEnabled: false, storedEnabled: true });
  });

  it.each([SupportedLanguages.EN, SupportedLanguages.PT])('supports delivery (and returns the language) for %s locale (RAD-320)', async (language) => {
    execute.mockResolvedValue(freshRow({ budgetAlertsEnabled: true, language }));
    await expect(service.getFreshWorkerEligibility(7, 'budgetAlerts')).resolves.toMatchObject({ deliverySupported: true, effectiveEnabled: true, language, storedEnabled: true });
  });

  it.each(['budgetAlerts', 'weeklyInsights'] as const)('honours the global marketing opt-out even when the %s stream flag is on', async (stream) => {
    execute.mockResolvedValue(freshRow({ budgetAlertsEnabled: true, marketingOptOut: new Date('2026-01-01'), weeklyInsightsEnabled: true }));
    await expect(service.getFreshWorkerEligibility(7, stream)).resolves.toMatchObject({ deliverySupported: true, effectiveEnabled: false, storedEnabled: true });
  });

  it('partially upserts without updating the omitted field', async () => {
    execute.mockImplementation((sql: string) => Promise.resolve(sql.startsWith('select')
      ? eligibleUser()
      : { account_recovery_enabled: true, budget_alerts_enabled: false, growth_emails_enabled: true, monthly_story_enabled: true, weekly_insights_enabled: true }));

    const result = await service.patchForAppuser(7, { budgetAlertsEnabled: false });

    const [sql] = execute.mock.calls[1] as [string];
    expect(execute.mock.calls[0]?.[0]).toContain('for update');
    expect(sql).toContain('"budget_alerts_enabled" = excluded."budget_alerts_enabled"');
    expect(sql).not.toContain('do update set "weekly_insights_enabled"');
    expect(sql).toContain('"deleted_at" = null');
    expect(sql).toContain('returning "account_recovery_enabled", "budget_alerts_enabled", "growth_emails_enabled", "monthly_story_enabled", "weekly_insights_enabled"');
    expect(execute.mock.calls[1]?.[2]).toBe('get');
    expect(result.weeklyInsights.storedEnabled).toBe(true);
    expect(result.budgetAlerts.storedEnabled).toBe(false);
  });

  it('also upserts the account-recovery and growth category flags', async () => {
    execute.mockImplementation((sql: string) => Promise.resolve(sql.startsWith('select')
      ? eligibleUser()
      : { account_recovery_enabled: false, budget_alerts_enabled: true, growth_emails_enabled: true, monthly_story_enabled: true, weekly_insights_enabled: true }));

    const result = await service.patchForAppuser(7, { accountRecoveryEnabled: false });

    const [sql] = execute.mock.calls[1] as [string];
    expect(sql).toContain('"account_recovery_enabled" = excluded."account_recovery_enabled"');
    expect(sql).not.toContain('do update set "growth_emails_enabled"');
    expect(result.accountRecovery.storedEnabled).toBe(false);
    expect(result.growth.storedEnabled).toBe(true);
  });

  it('persists an explicit monthlyStory opt-out', async () => {
    execute.mockImplementation((sql: string) => Promise.resolve(sql.startsWith('select')
      ? eligibleUser()
      : { account_recovery_enabled: true, budget_alerts_enabled: true, growth_emails_enabled: true, monthly_story_enabled: false, weekly_insights_enabled: true }));

    const result = await service.patchForAppuser(7, { monthlyStoryEnabled: false });

    const [sql] = execute.mock.calls[1] as [string];
    expect(sql).toContain('"monthly_story_enabled" = excluded."monthly_story_enabled"');
    expect(result.monthlyStory.storedEnabled).toBe(false);
  });

  it('rejects an empty patch', async () => {
    await expect(service.patchForAppuser(7, {})).rejects.toMatchObject({ message: EMAIL_NOTIFICATION_PREFERENCE_ERROR.EMPTY_PATCH, status: 400 } satisfies Partial<BadRequestError>);
    expect(execute).not.toHaveBeenCalled();
  });

  it('sets the global opt-out timestamp on first write and coalesces on a repeat write (idempotent)', async () => {
    let storedMarketingOptOut: Date | null = null;
    execute.mockImplementation((sql: string) => {
      if (sql.includes('for update')) return Promise.resolve(Object.assign(eligibleUser(), { marketingOptOut: storedMarketingOptOut }));
      if (sql.startsWith('update "appuser"')) return Promise.resolve(undefined);
      if (sql.includes('from "email_notification_preference"')) return Promise.resolve(undefined);
      throw new Error('unexpected query');
    });

    await service.patchForAppuser(7, { marketingOptOut: true });
    const [firstSql, firstParams] = execute.mock.calls[1] as [string, unknown[]];
    expect(firstSql).toContain('update "appuser" set "marketing_opt_out"');
    expect(firstParams[0]).toEqual(expect.any(Date));
    storedMarketingOptOut = firstParams[0] as Date;

    execute.mockClear();
    await service.patchForAppuser(7, { marketingOptOut: true });
    const [, repeatParams] = execute.mock.calls[1] as [string, unknown[]];
    expect(repeatParams[0]).toEqual(storedMarketingOptOut);
  });

  it('clears the global opt-out timestamp when explicitly re-enabled', async () => {
    execute.mockImplementation((sql: string) => {
      if (sql.includes('for update')) return Promise.resolve(Object.assign(eligibleUser(), { marketingOptOut: new Date('2026-01-01') }));
      if (sql.startsWith('update "appuser"')) return Promise.resolve(undefined);
      if (sql.includes('from "email_notification_preference"')) return Promise.resolve(undefined);
      throw new Error('unexpected query');
    });

    const result = await service.patchForAppuser(7, { marketingOptOut: false });
    const [, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(params[0]).toBeNull();
    expect(result.marketingOptOut).toBe(false);
  });

  it('does not touch the category upsert when only patching the global opt-out', async () => {
    execute.mockImplementation((sql: string) => {
      if (sql.includes('for update')) return Promise.resolve(eligibleUser());
      if (sql.startsWith('update "appuser"')) return Promise.resolve(undefined);
      if (sql.includes('from "email_notification_preference"')) return Promise.resolve(undefined);
      throw new Error('unexpected query');
    });

    await service.patchForAppuser(7, { marketingOptOut: true });

    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls.some(([sql]) => String(sql).startsWith('insert into "email_notification_preference"'))).toBe(false);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('from "email_notification_preference"'))).toBe(true);
  });

  it.each([
    ['invalid email', { emailAddress: 'unsupported' }],
    ['inactive', { recordActive: false }],
    ['deleted', { deletedAt: new Date() }],
  ])('rejects enabling for %s when delivery is unsupported', async (_label, changes) => {
    execute.mockResolvedValue(Object.assign(eligibleUser(), changes));
    await expect(service.patchForAppuser(7, { weeklyInsightsEnabled: true })).rejects.toMatchObject({ message: EMAIL_NOTIFICATION_PREFERENCE_ERROR.DELIVERY_UNSUPPORTED, status: 400 } satisfies Partial<BadRequestError>);
    expect(execute.mock.calls.some(([sql]) => String(sql).startsWith('insert into'))).toBe(false);
  });

  it('always permits disabling even when delivery gates fail', async () => {
    const user = Object.assign(eligibleUser(), { deletedAt: new Date(), language: SupportedLanguages.EN, recordActive: false });
    execute.mockImplementation((sql: string) => Promise.resolve(sql.startsWith('select') ? user : { budget_alerts_enabled: false, weekly_insights_enabled: false }));

    await expect(service.patchForAppuser(7, { budgetAlertsEnabled: false })).resolves.toMatchObject({
      budgetAlerts: { deliverySupported: false, effectiveEnabled: false, storedEnabled: false },
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
