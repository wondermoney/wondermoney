/**
 * Single source of truth for the email consent taxonomy: which optional
 * category each sender belongs to, which `EmailNotificationPreference` column
 * gates that category, and the shared send-time gate every optional sender
 * must consult (`canSendOptionalEmail`).
 */

/** Every optional (toggle-able) email category. Transactional emails have no category — they always send. */
export enum EmailCategory {
  ACCOUNT_RECOVERY = 'ACCOUNT_RECOVERY',
  BUDGET_ALERTS = 'BUDGET_ALERTS',
  GROWTH = 'GROWTH',
  WEEKLY_INSIGHTS = 'WEEKLY_INSIGHTS',
}

/** The subset of `EmailNotificationPreference` columns that gate optional-email categories. */
export interface EmailCategoryFlags {
  accountRecoveryEnabled: boolean;
  budgetAlertsEnabled: boolean;
  growthEmailsEnabled: boolean;
  weeklyInsightsEnabled: boolean;
}

/** category -> `EmailNotificationPreference` flag field name. The one place this mapping is defined. */
export const EMAIL_CATEGORY_FLAG: Record<EmailCategory, keyof EmailCategoryFlags> = {
  [EmailCategory.ACCOUNT_RECOVERY]: 'accountRecoveryEnabled',
  [EmailCategory.BUDGET_ALERTS]: 'budgetAlertsEnabled',
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
