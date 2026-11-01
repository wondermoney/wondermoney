import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';

import { DI } from '@app/database/di';
import { Appuser, SupportedLanguages } from '@entity/Appuser';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { canSendOptionalEmail, categoryEnabled, EmailCategory } from '@service/email/email-preferences';
import { BadRequestError, NotFoundError } from '@utils/errors';

export const EMAIL_NOTIFICATION_PREFERENCE_ERROR = {
  DELIVERY_UNSUPPORTED: 'EMAIL_NOTIFICATION_DELIVERY_UNSUPPORTED',
  EMPTY_PATCH: 'EMAIL_NOTIFICATION_PREFERENCE_PATCH_REQUIRED',
  USER_NOT_FOUND: 'EMAIL_NOTIFICATION_USER_NOT_FOUND',
} as const;

export interface EmailCategoryToggleState {
  effectiveEnabled: boolean;
  storedEnabled: boolean;
}

export interface EmailNotificationPreferencePatch {
  accountRecoveryEnabled?: boolean;
  budgetAlertsEnabled?: boolean;
  growthEmailsEnabled?: boolean;
  marketingOptOut?: boolean;
  monthlyStoryEnabled?: boolean;
  weeklyInsightsEnabled?: boolean;
}

export interface EmailNotificationPreferenceState {
  accountRecovery: EmailCategoryToggleState;
  budgetAlerts: EmailNotificationStreamState;
  growth: EmailCategoryToggleState;
  marketingOptOut: boolean;
  monthlyStory: EmailNotificationStreamState;
  weeklyInsights: EmailNotificationStreamState;
}

export type EmailNotificationStream = 'budgetAlerts' | 'monthlyStory' | 'weeklyInsights';

export interface EmailNotificationStreamState {
  deliverySupported: boolean;
  effectiveEnabled: boolean;
  storedEnabled: boolean;
}
export interface FreshWorkerEmailEligibility extends EmailNotificationStreamState {
  appuserKey: number;
  currencyCode: string;
  emailAddress: string;
  firstName: null | string;
  language: SupportedLanguages;
}

/** The `EmailNotificationPreference` columns read/written by the settings surface, keyed by their entity field name. */
type PreferenceCategoryColumns = Partial<Pick<EmailNotificationPreference, 'accountRecoveryEnabled' | 'budgetAlertsEnabled' | 'growthEmailsEnabled' | 'monthlyStoryEnabled' | 'weeklyInsightsEnabled'>>;

/**
 * Loosely typed so both a real `Appuser` entity (`marketingOptOut?: Date`) and
 * a raw-SQL row (`marketingOptOut: Date | null`) satisfy it structurally.
 */
interface GateAppuser {
  deletedAt?: Date | null;
  emailAddress: string;
  language: SupportedLanguages;
  marketingOptOut?: Date | null;
  recordActive: boolean;
}

interface LockedAppuserRow {
  appuserKey: number;
  deletedAt: Date | null;
  emailAddress: string;
  language: SupportedLanguages;
  marketingOptOut: Date | null;
  recordActive: boolean;
}

/** category -> `email_notification_preference` snake_case column name (mirrors `EMAIL_CATEGORY_FLAG`, but for the settings read/write raw SQL). */
const CATEGORY_PATCH_COLUMN: Record<'accountRecoveryEnabled' | 'budgetAlertsEnabled' | 'growthEmailsEnabled' | 'monthlyStoryEnabled' | 'weeklyInsightsEnabled', string> = {
  accountRecoveryEnabled: 'account_recovery_enabled',
  budgetAlertsEnabled: 'budget_alerts_enabled',
  growthEmailsEnabled: 'growth_emails_enabled',
  monthlyStoryEnabled: 'monthly_story_enabled',
  weeklyInsightsEnabled: 'weekly_insights_enabled',
};
const CATEGORY_PATCH_FIELDS = Object.keys(CATEGORY_PATCH_COLUMN) as (keyof typeof CATEGORY_PATCH_COLUMN)[];

const emailSchema = z.email();

export class EmailNotificationPreferenceService {
  private get em(): EntityManager {
    return this.injectedEm ?? DI.em;
  }

  constructor(private readonly injectedEm?: EntityManager) {}

  async evaluateStreamEligibility(appuserKey: number, stream: EmailNotificationStream): Promise<EmailNotificationStreamState> {
    return (await this.getForAppuser(appuserKey))[stream];
  }

  async getForAppuser(appuserKey: number): Promise<EmailNotificationPreferenceState> {
    const appuser = await this.em.findOne(Appuser, { appuserKey });
    if (!appuser) throw new NotFoundError(EMAIL_NOTIFICATION_PREFERENCE_ERROR.USER_NOT_FOUND);
    const preference = await this.em.findOne(EmailNotificationPreference, { appuserKey: appuser, deletedAt: null });
    return this.toState(appuser, preference);
  }

  async getFreshWorkerEligibility(appuserKey: number, stream: EmailNotificationStream): Promise<FreshWorkerEmailEligibility | null> {
    const rowResult = await this.em.getConnection().execute<{
      appuserKey: number;
      budgetAlertsEnabled: boolean | null;
      currencyCode: string;
      deletedAt: Date | null;
      emailAddress: string;
      firstName: null | string;
      language: SupportedLanguages;
      marketingOptOut: Date | null;
      monthlyStoryEnabled: boolean | null;
      recordActive: boolean;
      weeklyInsightsEnabled: boolean | null;
    }>(
      `select owner."appuser_key" as "appuserKey", owner."email_address" as "emailAddress", owner."first_name" as "firstName",
              owner."language", owner."record_active" as "recordActive", owner."deleted_at" as "deletedAt", owner."marketing_opt_out" as "marketingOptOut",
              currency."code" as "currencyCode",
              preference."budget_alerts_enabled" as "budgetAlertsEnabled", preference."weekly_insights_enabled" as "weeklyInsightsEnabled",
              preference."monthly_story_enabled" as "monthlyStoryEnabled"
       from "appuser" owner join "currency" currency on currency."currency_key" = owner."currency_key"
       left join "email_notification_preference" preference on preference."appuser_key" = owner."appuser_key" and preference."deleted_at" is null
       where owner."appuser_key" = ?`,
      [appuserKey],
      'get',
    );
    const row = rowResult as typeof rowResult | undefined;
    if (!row) return null;
    const gates = this.gates(row);
    const streamColumn = stream === 'budgetAlerts' ? row.budgetAlertsEnabled : stream === 'weeklyInsights' ? row.weeklyInsightsEnabled : row.monthlyStoryEnabled;
    const storedEnabled = storedOrDefault(streamColumn);
    return {
      appuserKey: row.appuserKey,
      currencyCode: row.currencyCode,
      deliverySupported: gates.deliverySupported,
      // The global unsubscribe always wins, even when the per-stream flag is still on, so a
      // marketing-opted-out user never receives budget/weekly mail.
      effectiveEnabled: storedEnabled && gates.deliverySupported && !row.marketingOptOut,
      emailAddress: row.emailAddress,
      firstName: row.firstName,
      language: row.language,
      storedEnabled,
    };
  }

  async patchForAppuser(appuserKey: number, patch: EmailNotificationPreferencePatch): Promise<EmailNotificationPreferenceState> {
    const categoryFields = CATEGORY_PATCH_FIELDS.filter((field) => patch[field] !== undefined);
    if (categoryFields.length === 0 && patch.marketingOptOut === undefined) {
      throw new BadRequestError(EMAIL_NOTIFICATION_PREFERENCE_ERROR.EMPTY_PATCH);
    }
    return this.em.transactional(async (tx) => {
      const lockedResult = await tx.getConnection().execute<LockedAppuserRow>(
        `select owner."appuser_key" as "appuserKey", owner."email_address" as "emailAddress", owner."language",
                owner."record_active" as "recordActive", owner."deleted_at" as "deletedAt", owner."marketing_opt_out" as "marketingOptOut"
         from "appuser" owner
         where owner."appuser_key" = ? for update of owner`,
        [appuserKey],
        'get',
      );
      const appuser = lockedResult as LockedAppuserRow | undefined;
      if (!appuser) throw new NotFoundError(EMAIL_NOTIFICATION_PREFERENCE_ERROR.USER_NOT_FOUND);
      const enabling = categoryFields.some((field) => patch[field] === true);
      if (enabling && !this.gates(appuser).deliverySupported) {
        throw new BadRequestError(EMAIL_NOTIFICATION_PREFERENCE_ERROR.DELIVERY_UNSUPPORTED);
      }

      // The global opt-out timestamp lives on `appuser`, not the preference row. `true` is
      // idempotent (coalesces — the earliest opt-out wins, mirroring `EmailGlobalOptOutService`);
      // `false` clears it outright so re-subscribing always takes effect immediately.
      let marketingOptOut = appuser.marketingOptOut;
      if (patch.marketingOptOut === true) marketingOptOut = appuser.marketingOptOut ?? new Date();
      else if (patch.marketingOptOut === false) marketingOptOut = null;
      if (patch.marketingOptOut !== undefined) {
        await tx.getConnection().execute('update "appuser" set "marketing_opt_out" = ? where "appuser_key" = ?', [marketingOptOut, appuserKey]);
      }

      const lockedAppuser = { ...appuser, marketingOptOut };
      if (categoryFields.length === 0) {
        // No category flag is changing (this is a marketing-opt-out-only patch): read the
        // current preference row instead of writing one, so the returned state is accurate
        // without disturbing stored category values.
        const preferenceRow = await tx.getConnection().execute<PreferenceCategoryColumns>(
          `select "account_recovery_enabled" as "accountRecoveryEnabled", "budget_alerts_enabled" as "budgetAlertsEnabled",
                  "growth_emails_enabled" as "growthEmailsEnabled", "monthly_story_enabled" as "monthlyStoryEnabled",
                  "weekly_insights_enabled" as "weeklyInsightsEnabled"
           from "email_notification_preference"
           where "appuser_key" = ? and "deleted_at" is null`,
          [appuserKey],
          'get',
        );
        // `execute(..., 'get')` resolves to undefined when the user has no preference row yet, but
        // MikroORM types it as the row. The widening assertion is what lets the `?? null` stand;
        // dropping it would make no-unnecessary-condition demand the fallback be removed.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- widens to admit the missing row
        return this.toState(lockedAppuser, (preferenceRow as PreferenceCategoryColumns | undefined) ?? null);
      }

      const now = new Date();
      const columns = categoryFields.map((field) => CATEGORY_PATCH_COLUMN[field]);
      const stored = await tx.getConnection().execute<Record<string, boolean>>(
        `insert into "email_notification_preference" ("appuser_key", "account_recovery_enabled", "budget_alerts_enabled", "growth_emails_enabled", "monthly_story_enabled", "weekly_insights_enabled", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict ("appuser_key") do update set ${columns.map((column) => `"${column}" = excluded."${column}"`).join(', ')}, "deleted_at" = null, "updated_at" = excluded."updated_at"
         returning "account_recovery_enabled", "budget_alerts_enabled", "growth_emails_enabled", "monthly_story_enabled", "weekly_insights_enabled"`,
        [
          appuserKey,
          patch.accountRecoveryEnabled ?? true,
          patch.budgetAlertsEnabled ?? true,
          patch.growthEmailsEnabled ?? true,
          patch.monthlyStoryEnabled ?? true,
          patch.weeklyInsightsEnabled ?? true,
          now,
          now,
        ],
        'get',
      );
      return this.toState(lockedAppuser, {
        accountRecoveryEnabled: stored['account_recovery_enabled'],
        budgetAlertsEnabled: stored['budget_alerts_enabled'],
        growthEmailsEnabled: stored['growth_emails_enabled'],
        monthlyStoryEnabled: stored['monthly_story_enabled'],
        weeklyInsightsEnabled: stored['weekly_insights_enabled'],
      });
    });
  }

  private gates(appuser: GateAppuser) {
    const active = appuser.recordActive && !appuser.deletedAt;
    // Financial lifecycle emails are localized for EN and PT (the only supported
    // languages); delivery is gated to those rather than PT-only.
    const localized = [SupportedLanguages.EN, SupportedLanguages.PT].includes(appuser.language);
    return {
      deliverySupported: active && localized && emailSchema.safeParse(appuser.emailAddress).success,
    };
  }

  private toState(appuser: GateAppuser, preference: null | PreferenceCategoryColumns): EmailNotificationPreferenceState {
    const gates = this.gates(appuser);
    const stream = (storedEnabled: boolean): EmailNotificationStreamState => ({
      ...gates,
      effectiveEnabled: storedEnabled && gates.deliverySupported && !appuser.marketingOptOut,
      storedEnabled,
    });
    const category = (emailCategory: EmailCategory): EmailCategoryToggleState => ({
      effectiveEnabled: canSendOptionalEmail(appuser, preference, emailCategory),
      storedEnabled: categoryEnabled(preference, emailCategory),
    });
    return {
      accountRecovery: category(EmailCategory.ACCOUNT_RECOVERY),
      budgetAlerts: stream(storedOrDefault(preference?.budgetAlertsEnabled)),
      growth: category(EmailCategory.GROWTH),
      marketingOptOut: Boolean(appuser.marketingOptOut),
      monthlyStory: stream(storedOrDefault(preference?.monthlyStoryEnabled)),
      weeklyInsights: stream(storedOrDefault(preference?.weeklyInsightsEnabled)),
    };
  }
}

/** Absence of a preference row means opted-in: notifications default on. */
function storedOrDefault(value: boolean | null | undefined): boolean {
  return value !== false;
}

export const emailNotificationPreferenceService = new EmailNotificationPreferenceService();
