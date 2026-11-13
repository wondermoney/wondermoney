import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { isPushEnabled } from '@config/push';
import { FeatureDisabledError } from '@utils/errors';

/**
 * The push categories. Each is its own switch beside the email one of the same name, stored on the
 * person's `email_notification_preference` row, and each is off until the person turns it on in the
 * mobile app (no row, or a row written before push existed, reads as off).
 */
export const PUSH_CATEGORIES = ['budgetAlerts', 'bankSyncAlerts', 'creditCardDueReminders'] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

export type PushPreferencePatch = Partial<PushPreferences>;
export type PushPreferences = Record<PushCategory, boolean>;

/** category -> `email_notification_preference` column. */
export const PUSH_CATEGORY_COLUMN: Record<PushCategory, string> = {
  bankSyncAlerts: 'push_bank_sync_alerts_enabled',
  budgetAlerts: 'push_budget_alerts_enabled',
  creditCardDueReminders: 'push_credit_card_due_reminders_enabled',
};

const SELECT_COLUMNS = PUSH_CATEGORIES.map((category) => `"${PUSH_CATEGORY_COLUMN[category]}" as "${category}"`).join(', ');

type StoredRow = Partial<Record<PushCategory, boolean | null>>;

const toPreferences = (row: StoredRow | undefined): PushPreferences => ({
  bankSyncAlerts: row?.bankSyncAlerts === true,
  budgetAlerts: row?.budgetAlerts === true,
  creditCardDueReminders: row?.creditCardDueReminders === true,
});

export class PushPreferenceService {
  private get em(): EntityManager {
    return this.injectedEm ?? DI.em;
  }

  constructor(private readonly injectedEm?: EntityManager) {}

  async getForAppuser(appuserKey: number): Promise<PushPreferences> {
    const row = await this.em.getConnection().execute<StoredRow>(
      `select ${SELECT_COLUMNS} from "email_notification_preference" where "appuser_key" = ? and "deleted_at" is null`,
      [appuserKey],
      'get',
    );
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- `execute(..., 'get')` resolves to undefined when there is no row
    return toPreferences(row as StoredRow | undefined);
  }

  /** Whether `category` is on for this person. The send-time gate every push sender consults. */
  async isEnabled(appuserKey: number, category: PushCategory): Promise<boolean> {
    return (await this.getForAppuser(appuserKey))[category];
  }

  /**
   * Changes the given categories and returns them all. Writing the row for the first time leaves
   * every email category at its default (on), exactly as having no row did. Turning a category on
   * needs push on this server; turning one off always works.
   */
  async patchForAppuser(appuserKey: number, patch: PushPreferencePatch, env: Readonly<Record<string, string | undefined>> = process.env): Promise<PushPreferences> {
    const categories = PUSH_CATEGORIES.filter((category) => patch[category] !== undefined);
    if (categories.length === 0) return this.getForAppuser(appuserKey);
    if (categories.some((category) => patch[category] === true) && !isPushEnabled(env)) throw new FeatureDisabledError('Push notifications');
    const columns = categories.map((category) => `"${PUSH_CATEGORY_COLUMN[category]}"`);
    const now = new Date();
    const row = await this.em.getConnection().execute<StoredRow[]>(
      `insert into "email_notification_preference" ("appuser_key", ${columns.join(', ')}, "created_at", "updated_at")
       values (?, ${columns.map(() => '?').join(', ')}, ?, ?)
       on conflict ("appuser_key") do update set ${columns.map((column) => `${column} = excluded.${column}`).join(', ')}, "deleted_at" = null, "updated_at" = excluded."updated_at"
       returning ${SELECT_COLUMNS}`,
      [appuserKey, ...categories.map((category) => patch[category] === true), now, now],
    );
    return toPreferences(row[0]);
  }
}

export const pushPreferenceService = new PushPreferenceService();
