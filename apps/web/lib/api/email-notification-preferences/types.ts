import type { AxiosError } from "axios";

/**
 * `budgetAlerts`/`weeklyInsights` are gated on account-level email
 * deliverability (language + a valid email address) in addition to the
 * stored toggle and the global marketing opt-out, so the API exposes
 * `deliverySupported` for them.
 */
export interface EmailNotificationStreamState {
  storedEnabled: boolean;
  effectiveEnabled: boolean;
  deliverySupported: boolean;
}

/**
 * `growth`/`accountRecovery`/`bankSyncAlerts` are gated only on the stored toggle and
 * the global marketing opt-out — no deliverability gate.
 */
export interface EmailCategoryPreferenceState {
  storedEnabled: boolean;
  effectiveEnabled: boolean;
}

export interface EmailNotificationPreferencesResponse {
  budgetAlerts: EmailNotificationStreamState;
  weeklyInsights: EmailNotificationStreamState;
  /** Still returned by the API, but no email is sent in this category any more, so it has no toggle. */
  growth: EmailCategoryPreferenceState;
  accountRecovery: EmailCategoryPreferenceState;
  /** Bank connection alerts: consent ending (7 days and 1 day before), ended early by the bank, or syncs failing for over 2 days. On by default. */
  bankSyncAlerts: EmailCategoryPreferenceState;
  /** Optional for compatibility with servers deployed before card reminders. Defaults on. */
  creditCardDueReminders?: EmailCategoryPreferenceState;
  /** Global unsubscribe: when true, every category's `effectiveEnabled` is false regardless of `storedEnabled`. */
  marketingOptOut: boolean;
}

export interface UpdateEmailNotificationPreferencesInput {
  budgetAlertsEnabled?: boolean;
  weeklyInsightsEnabled?: boolean;
  growthEmailsEnabled?: boolean;
  accountRecoveryEnabled?: boolean;
  bankSyncAlertsEnabled?: boolean;
  creditCardDueRemindersEnabled?: boolean;
  marketingOptOut?: boolean;
}

export interface EmailNotificationPreferencesErrorBody {
  code?: string;
  message?: string;
}

export type EmailNotificationPreferencesApiError = AxiosError<EmailNotificationPreferencesErrorBody>;
