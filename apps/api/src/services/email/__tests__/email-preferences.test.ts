import { describe, expect, it } from 'vitest';

import { canSendOptionalEmail, categoryEnabled, EMAIL_CATEGORY_FLAG, EmailCategory } from '../email-preferences';

describe('EMAIL_CATEGORY_FLAG', () => {
  it('maps each category to its own preference flag', () => {
    expect(EMAIL_CATEGORY_FLAG).toEqual({
      [EmailCategory.ACCOUNT_RECOVERY]: 'accountRecoveryEnabled',
      [EmailCategory.BUDGET_ALERTS]: 'budgetAlertsEnabled',
      [EmailCategory.GROWTH]: 'growthEmailsEnabled',
      [EmailCategory.WEEKLY_INSIGHTS]: 'weeklyInsightsEnabled',
    });
    expect(new Set(Object.values(EMAIL_CATEGORY_FLAG)).size).toBe(Object.keys(EmailCategory).length);
  });
});

describe('categoryEnabled', () => {
  it('is enabled when the mapped flag is explicitly true', () => {
    expect(categoryEnabled({ growthEmailsEnabled: true }, EmailCategory.GROWTH)).toBe(true);
  });

  it('is disabled when the mapped flag is explicitly false', () => {
    expect(categoryEnabled({ growthEmailsEnabled: false }, EmailCategory.GROWTH)).toBe(false);
  });

  it.each([null, undefined, {}])('defaults to enabled when the preference row is %s (opted-in by default)', (prefs) => {
    expect(categoryEnabled(prefs, EmailCategory.GROWTH)).toBe(true);
  });

  it('defaults to enabled when the specific column is null (raw-SQL left join with no row)', () => {
    expect(categoryEnabled({ accountRecoveryEnabled: null }, EmailCategory.ACCOUNT_RECOVERY)).toBe(true);
  });

  it.each(Object.values(EmailCategory))('%s reads only its own mapped flag, not any other category', (category) => {
    const flag = EMAIL_CATEGORY_FLAG[category];
    const allTrueExceptThis = Object.fromEntries(Object.values(EMAIL_CATEGORY_FLAG).map((otherFlag) => [otherFlag, otherFlag !== flag]));
    expect(categoryEnabled(allTrueExceptThis, category)).toBe(false);
  });
});

describe('canSendOptionalEmail', () => {
  it('is true when global opt-out is off and the category is enabled', () => {
    expect(canSendOptionalEmail({ marketingOptOut: undefined }, { budgetAlertsEnabled: true }, EmailCategory.BUDGET_ALERTS)).toBe(true);
  });

  it('is false when the account has globally opted out, even if the category is enabled', () => {
    expect(canSendOptionalEmail({ marketingOptOut: new Date('2026-01-01') }, { budgetAlertsEnabled: true }, EmailCategory.BUDGET_ALERTS)).toBe(false);
  });

  it('is false when the category itself is disabled', () => {
    expect(canSendOptionalEmail({ marketingOptOut: undefined }, { weeklyInsightsEnabled: false }, EmailCategory.WEEKLY_INSIGHTS)).toBe(false);
  });

  it('is false when both global opt-out is set and the category is disabled', () => {
    expect(canSendOptionalEmail({ marketingOptOut: new Date() }, { growthEmailsEnabled: false }, EmailCategory.GROWTH)).toBe(false);
  });

  it.each(Object.values(EmailCategory))('gates %s on its own flag independent of the others', (category) => {
    const flag = EMAIL_CATEGORY_FLAG[category];
    const prefs = { [flag]: true };
    expect(canSendOptionalEmail({ marketingOptOut: undefined }, prefs, category)).toBe(true);
    expect(canSendOptionalEmail({ marketingOptOut: undefined }, { [flag]: false }, category)).toBe(false);
  });
});
