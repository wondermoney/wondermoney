/**
 * Single source of truth for the email consent taxonomy: which optional
 * category each sender belongs to, which `EmailNotificationPreference` column
 * gates that category, and the shared send-time gate every optional sender
 * must consult (`canSendOptionalEmail`).
 */

/** Every optional (toggle-able) email category. Transactional emails have no category — they always send. */
export enum EmailCategory {
  ACCOUNT_RECOVERY = 'ACCOUNT_RECOVERY',
  BANK_SYNC_ALERTS = 'BANK_SYNC_ALERTS',
  BUDGET_ALERTS = 'BUDGET_ALERTS',
  CREDIT_CARD_DUE_REMINDERS = 'CREDIT_CARD_DUE_REMINDERS',
  GROWTH = 'GROWTH',
  WEEKLY_INSIGHTS = 'WEEKLY_INSIGHTS',
}

/** The subset of `EmailNotificationPreference` columns that gate optional-email categories. */
export interface EmailCategoryFlags {
  accountRecoveryEnabled: boolean;
  bankSyncAlertsEnabled: boolean;
  budgetAlertsEnabled: boolean;
  creditCardDueRemindersEnabled: boolean;
  growthEmailsEnabled: boolean;
  weeklyInsightsEnabled: boolean;
}

/** category -> `EmailNotificationPreference` flag field name. The one place this mapping is defined. */
export const EMAIL_CATEGORY_FLAG: Record<EmailCategory, keyof EmailCategoryFlags> = {
  [EmailCategory.ACCOUNT_RECOVERY]: 'accountRecoveryEnabled',
  [EmailCategory.BANK_SYNC_ALERTS]: 'bankSyncAlertsEnabled',
  [EmailCategory.BUDGET_ALERTS]: 'budgetAlertsEnabled',
  [EmailCategory.CREDIT_CARD_DUE_REMINDERS]: 'creditCardDueRemindersEnabled',
  [EmailCategory.GROWTH]: 'growthEmailsEnabled',
  [EmailCategory.WEEKLY_INSIGHTS]: 'weeklyInsightsEnabled',
};

/** A preference row (or a partial/raw-SQL projection of one), or none at all. */
export type EmailCategoryFlagsSource = null | Partial<Record<keyof EmailCategoryFlags, boolean | null | undefined>> | undefined;

/** An appuser (or a partial/raw-SQL projection of one) carrying the global opt-out timestamp. */
export interface MarketingOptOutAppuser {
  marketingOptOut?: Date | null;
}

/**
 * Whether `category` is enabled for this preference row. Absence of a stored
 * value (no row, or a `null`/`undefined` column from a raw-SQL left join)
 * means opted-in — mirrors `EmailNotificationPreferenceService`'s
 * `storedOrDefault` semantics so a missing row never silently suppresses mail.
 */
export function categoryEnabled(prefs: EmailCategoryFlagsSource, category: EmailCategory): boolean {
  return prefs?.[EMAIL_CATEGORY_FLAG[category]] !== false;
}

/**
 * The single gate every optional-email sender must consult before sending:
 * the account-wide unsubscribe wins over everything, then the category toggle.
 */
export function canSendOptionalEmail(appuser: MarketingOptOutAppuser, prefs: EmailCategoryFlagsSource, category: EmailCategory): boolean {
  return !appuser.marketingOptOut && categoryEnabled(prefs, category);
}

/** The subset of `Appuser` that `isRecipientReachable` reads. Structural, so a raw-SQL projection also satisfies it. */
export interface EmailRecipient {
  deletedAt?: Date | null;
  emailAddress?: null | string;
  recordActive?: boolean;
}

/**
 * True when the account can receive mail of any kind. Deletion scrubs the
 * address to an internal one and flips `recordActive`, so this is not a consent
 * question — the mailbox is gone. It therefore applies to transactional mail
 * too, and is checked before the opt-out: deletion sets `marketingOptOut` as a
 * side effect, and reporting that as the cause would misattribute it.
 */
export function isRecipientReachable<T extends EmailRecipient>(recipient: null | T | undefined): recipient is T {
  if (!recipient?.emailAddress) return false;
  if (recipient.deletedAt) return false;
  return recipient.recordActive !== false;
}
