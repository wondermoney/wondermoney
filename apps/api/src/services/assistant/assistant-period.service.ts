/**
 * Kept for the assistant's existing imports: the period maths lives with the shared tool layer
 * (`services/ai-tools/ai-tool-period.service.ts`) because the MCP server resolves the same
 * periods.
 */
export {
  type AiToolPeriodKey as AssistantPeriodKey,
  AiToolPeriodService as AssistantPeriodService,
  type AiToolResolvedPeriod as AssistantResolvedPeriod,
} from '@service/ai-tools/ai-tool-period.service';
