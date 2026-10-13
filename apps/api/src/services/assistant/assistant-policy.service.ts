const DEFAULT_ALLOWED_TOOLS = [
  'compare_budget_periods',
  'get_account_balance_summary',
  'get_budget_status',
  'get_cashflow_summary',
  'get_goal_progress_summary',
  'get_large_transactions_summary',
  'get_net_worth_summary',
  'get_portfolio_income_summary',
  'get_portfolio_summary',
  'get_recurring_payments_summary',
  'get_spending_by_category',
  'get_spending_trend',
] as const;

export type AssistantToolName = string;

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AssistantPolicyService {
  static assertToolAllowed({ assistantEnabled, toolName }: { assistantEnabled: boolean; toolName: AssistantToolName }) {
    if (!assistantEnabled) {
      return { allowed: false, reason: 'assistant_disabled' as const };
    }

    const allowedTools = AssistantPolicyService.getAllowedTools();
    if (!allowedTools.has(toolName)) {
      return { allowed: false, reason: 'tool_not_allowed' as const };
    }

    return { allowed: true as const };
  }

  private static getAllowedTools(): Set<string> {
    const configuredTools = process.env['ASSISTANT_ALLOWED_TOOLS'];
    if (configuredTools === undefined) {
      return new Set(DEFAULT_ALLOWED_TOOLS);
    }

    const defaultAllowedTools = new Set<string>(DEFAULT_ALLOWED_TOOLS);
    const configuredAllowedTools = configuredTools.split(',').map((tool) => tool.trim()).filter(Boolean);
    return new Set(configuredAllowedTools.filter((tool) => defaultAllowedTools.has(tool)));
  }
}

export { DEFAULT_ALLOWED_TOOLS };
