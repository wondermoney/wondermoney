import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { isPushEnabled } from '@config/push';
import type { BudgetThresholdFact } from '@service/budget/aggregation-types';
import { budgetCrossingKey } from '@service/email/financial-email-delivery.service';
import type { Enqueue } from '@service/queue/enqueue';
import logger from '@utils/logger';

import type { PushBudgetCrossing } from './push-messages';
import { hasPushDevice, queuePushNotification } from './push-notifier';
import { PushPreferenceService } from './push-preference.service';

export type BudgetPushOutcome = 'failed' | 'no_new_crossings' | 'queued' | 'skipped';

/** Budgets named in one notification at most; beyond that the text only counts them. */
const MAX_BUDGETS_PER_NOTIFICATION = 50;

/**
 * Budget alerts as push, from the same daily facts as the budget email
 * (`FinancialEmailUserWorkerService`). Email and push are separate switches and separately deduped:
 * each threshold crossing is pushed at most once per person (`push_notification_claim`, keyed like
 * the email's crossing), whether or not the email went out.
 */
export class BudgetPushNotifier {
  private readonly em: EntityManager;
  private readonly enabled: () => boolean;

  constructor(private readonly deps: { em?: EntityManager; enabled?: () => boolean; enqueue: Enqueue }) {
    this.em = deps.em ?? DI.em;
    this.enabled = deps.enabled ?? (() => isPushEnabled());
  }

  /**
   * Pushes the crossings in `facts` this person has not been pushed about yet. Never throws: a
   * failure here must not cost the person their budget email. A crossing whose notification could
   * not be queued is released, so the next run tries it again.
   */
  async notify(appuserKey: number, facts: readonly (BudgetThresholdFact & { tenantKey: number })[]): Promise<BudgetPushOutcome> {
    let claimed: string[] = [];
    try {
      if (!(await this.wants(appuserKey))) return 'skipped';
      const keyed = facts.map((fact) => ({
        fact,
        keys: fact.claimThresholds.map((threshold) => budgetCrossingKey({ budgetKey: fact.budgetKey, budgetTemplateCategoryKey: fact.budgetTemplateCategoryKey, month: fact.month, tenantKey: fact.tenantKey, threshold, year: fact.year })),
      }));
      claimed = await this.claim(appuserKey, [...new Set(keyed.flatMap((entry) => entry.keys))]);
      const fresh = new Set(claimed);
      const budgets: PushBudgetCrossing[] = keyed
        .filter((entry) => entry.keys.some((key) => fresh.has(key)))
        .map(({ fact }) => ({ budgetKey: fact.budgetKey, categoryName: fact.categoryName, month: fact.month, state: fact.state, year: fact.year }));
      if (budgets.length === 0) return 'no_new_crossings';
      const outcome = await queuePushNotification(appuserKey, { budgets: budgets.slice(0, MAX_BUDGETS_PER_NOTIFICATION), kind: 'budget_alert' }, { em: this.em, enabled: this.enabled, enqueue: this.deps.enqueue });
      if (outcome !== 'queued') {
        await this.release(appuserKey, claimed);
        return 'skipped';
      }
      return 'queued';
    } catch (error) {
      logger.warn({ appuserKey, error }, 'Budget alert push failed');
      await this.release(appuserKey, claimed).catch(() => undefined);
      return 'failed';
    }
  }

  /** Whether this person would get a budget push at all: push on here, their switch on, a phone registered. */
  async wants(appuserKey: number): Promise<boolean> {
    if (!this.enabled()) return false;
    if (!(await new PushPreferenceService(this.em).isEnabled(appuserKey, 'budgetAlerts'))) return false;
    return hasPushDevice(this.em, appuserKey);
  }

  /** Records the crossings not yet pushed and returns those; a crossing already recorded is left out. */
  private async claim(appuserKey: number, keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const now = new Date();
    const rows = await this.em.getConnection().execute<{ dedupeKey: string }[]>(
      `insert into "push_notification_claim" ("appuser_key", "dedupe_key", "created_at", "updated_at")
       values ${keys.map(() => '(?, ?, ?, ?)').join(', ')}
       on conflict ("appuser_key", "dedupe_key") do nothing
       returning "dedupe_key" as "dedupeKey"`,
      keys.flatMap((key) => [appuserKey, key, now, now]),
    );
    return rows.map((row) => row.dedupeKey);
  }

  private async release(appuserKey: number, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.em.getConnection().execute('delete from "push_notification_claim" where "appuser_key" = ? and "dedupe_key" in (?)', [appuserKey, keys]);
  }
}
