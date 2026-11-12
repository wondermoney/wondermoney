import type { z } from 'zod';

/**
 * The transport-neutral contract of a finance tool: the read-only tools and the `propose_*`
 * tools, which draft a change for the person to confirm and never write one.
 *
 * The in-app assistant (`services/assistant`) and the MCP server (`services/mcp`) both read
 * from these definition lists: they only differ in how they expose a tool to a model and
 * where they record the audit entry.
 */
export interface AiToolContext {
  appuserKey: number;
  /** ISO 4217 code of the caller's base currency, used when no viewer row can be read. */
  currency: string;
  /**
   * Who is calling, recorded on a proposal a `propose_*` tool drafts: the in-app assistant, or an
   * MCP client and the token it holds. Absent means the assistant. Read tools ignore it.
   */
  origin?: { apiTokenKey?: number; source: 'assistant' | 'mcp' };
  tenantKey: number;
}

export interface AiToolDataUsed {
  granularity?: string;
  period?: string;
  recordCount?: number;
  source: 'database';
}

export interface AiToolDefinition<TInput = unknown, TData = unknown> {
  description: string;
  execute: (input: TInput, context: AiToolContext) => Promise<AiToolResult<TData>>;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  name: AiToolName;
}

export type AiToolName =
  | 'compare_budget_periods'
  | 'get_account_balance_summary'
  | 'get_budget_status'
  | 'get_cashflow_summary'
  | 'get_goal_progress_summary'
  | 'get_insights'
  | 'get_large_transactions_summary'
  | 'get_net_worth_summary'
  | 'get_portfolio_income_summary'
  | 'get_portfolio_summary'
  | 'get_recurring_payments_summary'
  | 'get_spending_by_category'
  | 'get_spending_trend'
  | 'list_accounts'
  | 'list_budgets'
  | 'list_categories'
  | 'propose_categorize_transactions'
  | 'propose_mark_transactions_reviewed'
  | 'propose_update_transaction_note'
  | 'search_transactions';

export interface AiToolResult<TData> {
  data: TData;
  dataUsed: AiToolDataUsed;
}

/**
 * Call a tool with input that arrived over a transport (the AI SDK, MCP JSON-RPC).
 *
 * The definition list is typed with `never` for its input so one array can hold every tool's
 * schema. The transport has already validated the input against that schema, so this is the
 * one place that widens it back to `unknown` for the call.
 */
export function executeAiTool<TData>(
  definition: AiToolDefinition<never>,
  input: unknown,
  context: AiToolContext,
): Promise<AiToolResult<TData>> {
  const execute = definition.execute as unknown as (input: unknown, context: AiToolContext) => Promise<AiToolResult<TData>>;
  return execute(input, context);
}
