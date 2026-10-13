import { tool } from 'ai';
import { z } from 'zod';

import { DI } from '@app/app';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';
import { AssistantAuditEventType } from '@entity/AssistantAuditLog';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { resolveAiRoute } from '@service/ai/ai-provider';
import { getRef } from '@utils/em-helpers';

import { AssistantAuditService } from './assistant-audit.service';
import { AssistantPeriodService } from './assistant-period.service';
import { AssistantPolicyService, DEFAULT_ALLOWED_TOOLS } from './assistant-policy.service';
import { AssistantRedactionService } from './assistant-redaction.service';
import type { AssistantToolContext, AssistantToolResult } from './assistant-tool-types';

const periodSchema = z.enum(['current_month', 'previous_month', 'last_90_days', 'year_to_date', 'last_12_months']);
type PeriodInput = z.infer<typeof periodSchema>;

type ToolName = (typeof DEFAULT_ALLOWED_TOOLS)[number];
type TransactionLike = Pick<Transaction, 'appuserSettlementAmount' | 'editedSettlementAmount' | 'transactionTypeKey'>;

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AssistantToolsService {
  static createTools(context: AssistantToolContext) {
    const tools = {
      compare_budget_periods: createTool('compare_budget_periods', 'Read-only comparison of budget periods.', context, z.object({ period: periodSchema.optional() }), () => Promise.resolve({ data: { comparison: [] as { period: string }[] }, dataUsed: { granularity: 'summary', period: 'current', source: 'stub' } })),
      get_account_balance_summary: createTool('get_account_balance_summary', 'Read-only, privacy-minimizing summary of account balances.', context, z.object({ period: periodSchema.optional() }), () => Promise.resolve({ data: { accounts: [] as { balance: number; name: string }[] }, dataUsed: { granularity: 'summary', period: 'current', source: 'stub' } })),
      get_budget_status: createTool('get_budget_status', 'Read-only, privacy-minimizing budget status summary.', context, z.object({ period: periodSchema.default('current_month') }), async ({ period }: { period: PeriodInput }) => {
        const resolved = AssistantPeriodService.resolve(period);
        const tenantMembership = await DI.em.findOne(AppuserTenant, {
          appuserKey: appuserRef(context.appuserKey),
          deletedAt: undefined,
          recordActive: true,
          tenantKey: tenantRef(context.tenantKey),
        });
        if (!tenantMembership) {
          return { data: { budgeted: 0, remaining: 0, spent: 0, status: 'no_tenant_access' }, dataUsed: { granularity: 'budget_status', period: resolved.key, recordCount: 0, source: 'database' } };
        }
        const budget = await DI.em.findOne(Budget, { deletedAt: undefined });
        if (!budget) {
          return { data: { budgeted: 0, remaining: 0, spent: 0, status: 'no_budget' }, dataUsed: { granularity: 'budget_status', period: resolved.key, recordCount: 0, source: 'database' } };
        }
        const budgetRows = await DI.em.find(BudgetTemplateCategory, {
          $or: getPeriodMonths(resolved),
          budgetKey: budget,
          categoryKey: { deletedAt: undefined },
        }, { populate: ['categoryKey'] });
        const budgeted = budgetRows.reduce((sum, row) => sum + toNumber(row.amountBudgeted), 0);
        const budgetCategories = budgetRows.map((row) => row.categoryKey);
        const categoryLinks = budgetCategories.length
          ? await DI.em.find(AppuserTransactionCategory, {
            appuserKey: appuserRef(context.appuserKey),
            categoryKey: { $in: budgetCategories, deletedAt: undefined },
            deletedAt: undefined,
            transactionKey: {
              accountKey: { closed: false, deletedAt: undefined },
              appuserKey: appuserRef(context.appuserKey),
              deletedAt: undefined,
              tenantKey: tenantRef(context.tenantKey),
              transactionDate: { $gte: resolved.start, $lte: resolved.end },
            },
          }, { populate: ['transactionKey', 'transactionKey.transactionTypeKey'] })
          : [];
        const spent = categoryLinks.reduce((sum, link) => {
          const transaction = link.transactionKey;
          if (isTransfer(transaction)) return sum;
          const amount = getEffectiveAmount(transaction);
          return amount < 0 ? sum + Math.abs(amount) : sum;
        }, 0);
        const remaining = budgeted - spent;
        return { data: { budgeted, remaining, spent, status: budgetRows.length ? 'active' : 'empty' }, dataUsed: { granularity: 'budget_status', period: resolved.key, recordCount: budgetRows.length, source: 'database' } };
      }),
      get_cashflow_summary: createTool('get_cashflow_summary', 'Read-only, privacy-minimizing cashflow summary.', context, z.object({ period: periodSchema.default('current_month') }), async ({ period }: { period: PeriodInput }) => {
        const resolved = AssistantPeriodService.resolve(period);
        const transactions = (await findScopedTransactions(context, resolved)).filter((transaction) => !isTransfer(transaction));
        const totals = transactions.reduce(
          (acc, transaction) => {
            const amount = getEffectiveAmount(transaction);
            if (amount > 0) acc.inflow += amount;
            if (amount < 0) acc.outflow += Math.abs(amount);
            acc.net += amount;
            return acc;
          },
          { inflow: 0, net: 0, outflow: 0 },
        );
        return { data: totals, dataUsed: { granularity: resolved.granularity, period: resolved.key, recordCount: transactions.length, source: 'database' } };
      }),
      get_goal_progress_summary: createTool('get_goal_progress_summary', 'Read-only goal progress summary.', context, z.object({ period: periodSchema.optional() }), () => Promise.resolve({ data: { goals: [] as { progress: number }[] }, dataUsed: { granularity: 'summary', period: 'current', source: 'stub' } })),
      get_large_transactions_summary: createTool('get_large_transactions_summary', 'Read-only summary of large transactions.', context, z.object({ period: periodSchema.optional() }), () => Promise.resolve({ data: { transactions: [] as { amount: number }[] }, dataUsed: { granularity: 'summary', period: 'current', source: 'stub' } })),
      get_net_worth_summary: createTool('get_net_worth_summary', 'Read-only, privacy-minimizing summary of current net worth.', context, z.object({ period: periodSchema.optional() }), () => Promise.resolve({ data: { netWorth: null }, dataUsed: { granularity: 'summary', period: 'current', source: 'stub' } })),
      get_portfolio_income_summary: createTool('get_portfolio_income_summary', 'Read-only portfolio income summary.', context, z.object({ period: periodSchema.optional() }), () => Promise.resolve({ data: { income: null }, dataUsed: { granularity: 'summary', period: 'current', source: 'stub' } })),
      get_portfolio_summary: createTool('get_portfolio_summary', 'Read-only portfolio summary.', context, z.object({ period: periodSchema.optional() }), () => Promise.resolve({ data: { portfolioValue: null }, dataUsed: { granularity: 'summary', period: 'current', source: 'stub' } })),
      get_recurring_payments_summary: createTool('get_recurring_payments_summary', 'Read-only recurring payments summary.', context, z.object({ period: periodSchema.optional() }), () => Promise.resolve({ data: { recurringPayments: [] as { amount: number }[] }, dataUsed: { granularity: 'summary', period: 'current', source: 'stub' } })),
      get_spending_by_category: createTool('get_spending_by_category', 'Read-only, privacy-minimizing spending breakdown by category.', context, z.object({ period: periodSchema.default('current_month') }), async ({ period }: { period: PeriodInput }) => {
        const resolved = AssistantPeriodService.resolve(period);
        const categoryLinks = await DI.em.find(AppuserTransactionCategory, {
          appuserKey: appuserRef(context.appuserKey),
          categoryKey: { deletedAt: undefined },
          deletedAt: undefined,
          transactionKey: {
            accountKey: { closed: false, deletedAt: undefined },
            appuserKey: appuserRef(context.appuserKey),
            deletedAt: undefined,
            tenantKey: tenantRef(context.tenantKey),
            transactionDate: { $gte: resolved.start, $lte: resolved.end },
          },
        }, { populate: ['categoryKey', 'transactionKey', 'transactionKey.transactionTypeKey'] });
        const totalsByCategory = new Map<string, number>();
        for (const link of categoryLinks) {
          const transaction = link.transactionKey;
          if (isTransfer(transaction)) continue;
          const amount = getEffectiveAmount(transaction);
          if (amount >= 0) continue;
          const categoryName = link.categoryKey.name;
          totalsByCategory.set(categoryName, (totalsByCategory.get(categoryName) ?? 0) + Math.abs(amount));
        }
        const categories = Array.from(totalsByCategory.entries())
          .map(([category, amount]) => ({ amount, category }))
          .sort((a, b) => b.amount - a.amount);
        return { data: { categories }, dataUsed: { granularity: 'category_totals', period: resolved.key, recordCount: categoryLinks.length, source: 'database' } };
      }),
      get_spending_trend: createTool('get_spending_trend', 'Read-only spending trend summary.', context, z.object({ period: periodSchema.optional() }), () => Promise.resolve({ data: { trend: [] as number[] }, dataUsed: { granularity: 'summary', period: 'current', source: 'stub' } })),
    };

    return Object.fromEntries(
      Object.entries(tools).filter(([toolName]) => {
        const policy = AssistantPolicyService.assertToolAllowed({ assistantEnabled: true, toolName });
        if (!policy.allowed) {
          void AssistantAuditService.log(DI.em, {
            appuserKey: context.appuserKey,
            consentVersion: context.consentVersion,
            conversationId: context.conversationId,
            eventType: AssistantAuditEventType.TOOL_DENIED,
            metadata: {
              status: policy.reason,
              toolName,
            },
            ...assistantAuditModel(),
            tenantKey: context.tenantKey,
            toolName,
          });
        }
        return policy.allowed;
      }),
    ) as typeof tools;
  }

  static getToolNames(): ToolName[] { return [...DEFAULT_ALLOWED_TOOLS]; }
}

/** Which model the audit log records a tool event against. */
function appuserRef(appuserKey: number) {
  return getRef(DI.em, Appuser, appuserKey);
}

function assistantAuditModel(): { model: string | undefined; provider: string } {
  const route = resolveAiRoute('assistant');
  if (route.kind === 'openai-compatible') return { model: route.model, provider: 'openai-compatible' };
  return { model: route.kind === 'azure-openai' ? route.model ?? undefined : undefined, provider: 'azure' };
}

function createTool<TInputSchema extends z.ZodTypeAny, TData>(toolName: ToolName, description: string, context: AssistantToolContext, inputSchema: TInputSchema, execute: (input: z.infer<TInputSchema>) => Promise<AssistantToolResult<TData>>) {
  return tool({
    description,
    execute: async (input) => {
      const result = AssistantRedactionService.redact(await execute(input));
      const dataUsed = result.dataUsed;
      await AssistantAuditService.log(DI.em, {
        appuserKey: context.appuserKey,
        consentVersion: context.consentVersion,
        conversationId: context.conversationId,
        eventType: AssistantAuditEventType.TOOL_CALLED,
        metadata: {
          granularity: dataUsed.granularity,
          period: dataUsed.period,
          recordCount: dataUsed.recordCount,
          source: dataUsed.source,
          status: 'completed',
          toolName,
        },
        ...assistantAuditModel(),
        tenantKey: context.tenantKey,
        toolName,
      });
      return result;
    },
    inputSchema,
  });
}

async function findScopedTransactions(context: AssistantToolContext, period: ReturnType<typeof AssistantPeriodService.resolve>) {
  return DI.em.find(Transaction, {
    accountKey: { closed: false, deletedAt: undefined },
    deletedAt: undefined,
    tenantKey: tenantRef(context.tenantKey),
    transactionDate: { $gte: period.start, $lte: period.end },
  }, { populate: ['transactionTypeKey'] });
}

function getEffectiveAmount(transaction: TransactionLike): number {
  return toNumber(transaction.editedSettlementAmount ?? transaction.appuserSettlementAmount);
}

function getPeriodMonths(period: ReturnType<typeof AssistantPeriodService.resolve>) {
  const months: { month: number; year: number }[] = [];
  const cursor = new Date(period.start.getFullYear(), period.start.getMonth(), 1);
  const end = new Date(period.end.getFullYear(), period.end.getMonth(), 1);

  while (cursor <= end) {
    months.push({ month: cursor.getMonth() + 1, year: cursor.getFullYear() });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function isTransfer(transaction: TransactionLike): boolean {
  const transactionType = transaction.transactionTypeKey;
  if (!transactionType) return false;
  const typeName = transactionType.name.toLowerCase();
  return typeName === 'transfer_in' || typeName === 'transfer_out' || typeName === 'transfer';
}

function tenantRef(tenantKey: number) {
  return getRef(DI.em, Tenant, tenantKey);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
}
