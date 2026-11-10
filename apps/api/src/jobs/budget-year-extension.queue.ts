export const BUDGET_YEAR_EXTENSION_QUEUE = 'budget.year-extension';

/**
 * 1 December, 04:00 UTC: every active budget gets next year's rows a month ahead, so January
 * opens with a budget. A budget the run misses is still extended when someone opens a month of
 * that year (`ensureBudgetYear` in the budget controller).
 */
export const BUDGET_YEAR_EXTENSION_CRON = '0 4 1 12 *';

export const ensureBudgetYearExtensionQueue = (boss: {
  createQueue: (queue: string, options?: Record<string, unknown>) => Promise<unknown>;
}) => boss.createQueue(BUDGET_YEAR_EXTENSION_QUEUE, {
  expireInSeconds: 1_800,
  policy: 'exclusive',
  // The extension is idempotent, so a retry only fills in the budgets a failed run missed.
  retryBackoff: true,
  retryDelay: 600,
  retryLimit: 3,
});

export const scheduleBudgetYearExtensionJob = (boss: {
  schedule: (name: string, cron: string, data?: null | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
}) =>
  boss.schedule(BUDGET_YEAR_EXTENSION_QUEUE, BUDGET_YEAR_EXTENSION_CRON, {}, {
    key: BUDGET_YEAR_EXTENSION_QUEUE,
    singletonKey: BUDGET_YEAR_EXTENSION_QUEUE,
    tz: 'UTC',
  });
