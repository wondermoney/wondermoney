import { describe, expect, it } from 'vitest';

import { patchEmailNotificationPreferencesSchema } from '../email-notifications';

describe('patchEmailNotificationPreferencesSchema', () => {
  it.each(['budgetAlertsEnabled', 'weeklyInsightsEnabled', 'growthEmailsEnabled', 'accountRecoveryEnabled', 'marketingOptOut'])(
    'accepts a patch that only sets %s',
    (field) => {
      expect(patchEmailNotificationPreferencesSchema.safeParse({ body: { [field]: true } }).success).toBe(true);
    },
  );

  it('accepts a patch combining category flags and the global opt-out', () => {
    expect(
      patchEmailNotificationPreferencesSchema.safeParse({
        body: { accountRecoveryEnabled: false, growthEmailsEnabled: true, marketingOptOut: true },
      }).success,
    ).toBe(true);
  });

  it('rejects an empty patch even when only new fields exist', () => {
    expect(patchEmailNotificationPreferencesSchema.safeParse({ body: {} }).success).toBe(false);
  });
});
