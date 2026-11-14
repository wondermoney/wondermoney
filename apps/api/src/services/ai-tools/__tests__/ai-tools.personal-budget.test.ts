import { startOfMonth } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addBudget } from '@app/__tests__/__helpers__/budget-fixtures';
import { addPartner, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import { HouseholdRole } from '@entity/AppuserTenant';
import { type AiToolContext, type AiToolName, executeAiTool } from '@service/ai-tools/ai-tool-types';
import { AI_TOOL_DEFINITIONS } from '@service/ai-tools/ai-tools.service';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

/*
 * The assistant and MCP clients read budgets through the same tools. A member's personal budget is
 * in none of them for anyone else in the household, the household's owner and admins included; its
 * owner sees it, labelled personal, without it displacing the household's budget.
 */
describe('a personal budget in the assistant and MCP tools', () => {
  const db = useTestDatabase();
  const now = new Date(startOfMonth(new Date()).getTime() + 12 * 60 * 60 * 1000);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  beforeEach(() => {
    DI.em = db.em();
  });

  async function runTool(name: AiToolName, input: unknown, context: AiToolContext) {
    const definition = AI_TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
    if (!definition) throw new Error(`No tool ${name}`);
    return executeAiTool(definition, input, context);
  }

  const contextFor = (home: Household, member: Appuser): AiToolContext => ({ appuserKey: member.appuserKey, currency: 'EUR', tenantKey: home.tenant.tenantKey });

  async function setup(options: { withHouseholdBudget: boolean }) {
    const em = db.em();
    const home = await seedHousehold(em);
    const admin = await addPartner(em, home, { role: HouseholdRole.ADMIN });
    const owner = await addPartner(em, home);
    const personal = await addBudget(em, home, { lines: [{ amount: 40, months: [month], name: 'Mine line', year }], name: 'Mine' });
    personal.budget.appuserKey = owner;
    personal.budget.ownerAppuserKey = owner;
    await em.flush();
    if (options.withHouseholdBudget) await addBudget(em, home, { lines: [{ amount: 300, months: [month], name: 'Shared line', year }], name: 'Shared' });
    return { admin, home, owner };
  }

  it('is in no other member\'s budget list or budget status', async () => {
    const { admin, home } = await setup({ withHouseholdBudget: false });

    for (const member of [home.appuser, admin]) {
      const list = await runTool('list_budgets', {}, contextFor(home, member));
      const status = await runTool('get_budget_status', { period: 'current_month' }, contextFor(home, member));
      const comparison = await runTool('compare_budget_periods', {}, contextFor(home, member));

      expect((list.data as { budgets: unknown[] }).budgets).toEqual([]);
      expect(status.data).toMatchObject({ budgeted: 0, status: 'no_budget' });
      expect(JSON.stringify(comparison.data)).not.toContain('40');
    }
  });

  it('is listed for its owner as personal, after the household\'s budget, which budget status keeps reading', async () => {
    const { home, owner } = await setup({ withHouseholdBudget: true });

    const list = await runTool('list_budgets', {}, contextFor(home, owner));
    const status = await runTool('get_budget_status', { period: 'current_month' }, contextFor(home, owner));
    const adminList = await runTool('list_budgets', {}, contextFor(home, home.appuser));

    expect((list.data as { budgets: { name: string; visibility: string }[] }).budgets.map(({ name, visibility }) => ({ name, visibility }))).toEqual([
      { name: 'Shared', visibility: 'household' },
      { name: 'Mine', visibility: 'personal' },
    ]);
    expect(status.data).toMatchObject({ budgeted: 300 });
    expect((adminList.data as { budgets: { name: string }[] }).budgets.map((budget) => budget.name)).toEqual(['Shared']);
  });
});
