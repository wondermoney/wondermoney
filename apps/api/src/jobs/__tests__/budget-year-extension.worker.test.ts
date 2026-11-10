import type { Job } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import { addBudget, budgetRows } from '@app/__tests__/__helpers__/budget-fixtures';
import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';

import { handleBudgetYearExtensionJob } from '../budget-year-extension.worker';

/*
 * On 1 December every active budget gets next year's rows, copied from this December, so the
 * budget is there in January before anyone opens it.
 */
describe('the yearly budget extension', () => {
  const db = useTestDatabase();
  const job = { data: {}, id: 'job-1', name: 'budget.year-extension' } as Job<Record<string, never>>;
  const logger = { error: vi.fn(), info: vi.fn() };
  const firstOfDecember = () => new Date('2026-12-01T04:00:00Z');

  it('extends the active budgets of every household into next year, once', async () => {
    const em = db.em();
    const first = await seedHousehold(em);
    const second = await seedHousehold(em);
    const { budget: ours } = await addBudget(em, first, { lines: [{ amount: 100, name: 'Groceries', year: 2026 }] });
    const { budget: theirs } = await addBudget(em, second, { lines: [{ amount: 70, name: 'Fuel', year: 2026 }, { amount: 20, name: 'Gifts', year: 2026 }] });
    const { budget: deleted } = await addBudget(em, second, { deleted: true, lines: [{ amount: 10, name: 'Old', year: 2026 }] });

    const firstRun = await handleBudgetYearExtensionJob(job, { em: db.em(), logger, now: firstOfDecember });
    const secondRun = await handleBudgetYearExtensionJob(job, { em: db.em(), logger, now: firstOfDecember });

    expect(firstRun).toMatchObject({ budgets: 2, rowsCreated: 36, year: 2027 });
    expect(secondRun).toMatchObject({ budgets: 2, rowsCreated: 0, year: 2027 });
    expect(await budgetRows(db.em(), ours.budgetKey, { year: 2027 })).toHaveLength(12);
    expect(await budgetRows(db.em(), theirs.budgetKey, { year: 2027 })).toHaveLength(24);
    expect(await budgetRows(db.em(), deleted.budgetKey, { year: 2027 })).toHaveLength(0);
  });

  it('extends the other budgets when one fails, then fails the job so pg-boss retries it', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const { budget: first } = await addBudget(em, household, { lines: [{ amount: 100, name: 'Groceries', year: 2026 }] });
    const { budget: second } = await addBudget(em, household, { lines: [{ amount: 50, name: 'Fuel', year: 2026 }] });
    const ensure = vi.fn(async (...args: Parameters<typeof import('@service/budget/budget-year.service').ensureBudgetYear>) => {
      if (args[1].budgetKey === first.budgetKey) throw new Error('boom');
      const { ensureBudgetYear } = await import('@service/budget/budget-year.service');
      return ensureBudgetYear(...args);
    });

    await expect(handleBudgetYearExtensionJob(job, { em: db.em(), ensureBudgetYear: ensure, logger, now: firstOfDecember })).rejects.toThrow(/1 of 2 budgets/);

    expect(await budgetRows(db.em(), second.budgetKey, { year: 2027 })).toHaveLength(12);
  });
});
