import { describe, expect, it } from 'vitest';

import { CREDIT_CARD_DUE_REMINDER_DAYS_DEFAULT, creditCardDueReminderDays } from '@app/jobs/credit-card-due-reminder.queue';

describe('credit card due reminder lead time', () => {
  it('defaults to three days when the environment says nothing', () => {
    expect(creditCardDueReminderDays({})).toBe(3);
    expect(CREDIT_CARD_DUE_REMINDER_DAYS_DEFAULT).toBe(3);
  });

  it('reads the configured number of days', () => {
    expect(creditCardDueReminderDays({ CREDIT_CARD_DUE_REMINDER_DAYS: '7' })).toBe(7);
    expect(creditCardDueReminderDays({ CREDIT_CARD_DUE_REMINDER_DAYS: '0' })).toBe(0);
  });

  it('falls back to the default rather than turning a malformed value into NaN days', () => {
    expect(creditCardDueReminderDays({ CREDIT_CARD_DUE_REMINDER_DAYS: 'soon' })).toBe(3);
    expect(creditCardDueReminderDays({ CREDIT_CARD_DUE_REMINDER_DAYS: '-2' })).toBe(3);
    expect(creditCardDueReminderDays({ CREDIT_CARD_DUE_REMINDER_DAYS: '  ' })).toBe(3);
  });
});
