import type { EntityManager } from '@mikro-orm/postgresql';
import type { Job } from 'pg-boss';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import { Budget } from '@entity/Budget';
import { ensureBudgetYear } from '@service/budget/budget-year.service';
import logger from '@utils/logger';

interface BudgetYearExtensionDeps {
  em?: EntityManager;
  ensureBudgetYear?: typeof ensureBudgetYear;
  logger?: Pick<Logger, 'error' | 'info'>;
  now?: () => Date;
}

/**
 * Extend every active budget, of every household, into next year. The worker EM has no tenant
 * context, so the budget list spans all tenants; each extension is scoped to its budget's own
 * tenant. One budget failing does not stop the others; the job then fails so pg-boss retries,
 * and the retry skips the budgets already extended.
 */
export const handleBudgetYearExtensionJob = async (job: Job<Record<string, never>>, deps: BudgetYearExtensionDeps = {}) => {
  const em = deps.em ?? DI.em;
  const extend = deps.ensureBudgetYear ?? ensureBudgetYear;
  const log = deps.logger ?? logger;
  const year = (deps.now?.() ?? new Date()).getUTCFullYear() + 1;

  const budgets = await em.find(Budget, { deletedAt: null }, { fields: ['budgetKey', 'tenantKey'], orderBy: { budgetKey: 'asc' } });
  let rowsCreated = 0;
  let failed = 0;
  for (const budget of budgets) {
    try {
      rowsCreated += await extend(em, { budgetKey: budget.budgetKey, tenantKey: budget.tenantKey.tenantKey, year });
    } catch (error) {
      failed += 1;
      log.error({ budgetKey: budget.budgetKey, error, jobId: job.id, year }, 'Budget year extension failed for a budget');
    }
  }

  const result = { budgets: budgets.length, failed, rowsCreated, year };
  log.info({ jobId: job.id, ...result }, 'Budget year extension finished');
  if (failed > 0) throw new Error(`Budget year extension failed for ${failed} of ${budgets.length} budgets`);
  return result;
};
