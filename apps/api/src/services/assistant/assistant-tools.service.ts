import { tool } from 'ai';
import type { z } from 'zod';

import { DI } from '@app/app';
import { AssistantAuditEventType } from '@entity/AssistantAuditLog';
import { AI_PROPOSAL_TOOL_DEFINITIONS, AI_PROPOSAL_TOOL_NAMES } from '@service/ai-tools/ai-proposal-tools.service';
import { type AiToolContext, type AiToolDefinition, type AiToolName, executeAiTool } from '@service/ai-tools/ai-tool-types';
import { AI_TOOL_DEFINITIONS, AI_TOOL_NAMES } from '@service/ai-tools/ai-tools.service';
import { resolveAiRoute } from '@service/ai/ai-provider';

import { AssistantAuditService } from './assistant-audit.service';
import { AssistantPolicyService, DEFAULT_ALLOWED_TOOLS } from './assistant-policy.service';
import { AssistantRedactionService } from './assistant-redaction.service';
import type { AssistantToolContext } from './assistant-tool-types';

/**
 * The assistant's view of the shared tool layer (`services/ai-tools`): the read-only tools and the
 * `propose_*` tools, which draft a change for the person to confirm in the chat.
 *
 * The MCP server exposes the same definitions; this class only adds what is specific to the
 * in-app chat: the `ASSISTANT_ALLOWED_TOOLS` policy, the AI SDK `tool()` wrapper and the
 * assistant audit entries.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AssistantToolsService {
  static createTools(context: AssistantToolContext) {
    /*
     * Every amount the shared layer returns is a bare number, and a bare number reads as dollars
     * to the model. So each result names its ISO 4217 currency: aggregates are summed from the
     * user-currency columns and so are in the base currency, a budget is in its own currency, and
     * per-account figures carry the account's.
     */
    const toolContext: AiToolContext = {
      appuserKey: context.appuserKey,
      currency: context.currency,
      origin: { source: 'assistant' },
      tenantKey: context.tenantKey,
    };
    const tools = Object.fromEntries(
      [...AI_TOOL_DEFINITIONS, ...AI_PROPOSAL_TOOL_DEFINITIONS].map((definition) => [definition.name, createTool(definition, context, toolContext)]),
    );

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
    ) as unknown as Record<AiToolName, ReturnType<typeof tool>>;
  }

  static getToolNames() {
    return [...DEFAULT_ALLOWED_TOOLS];
  }

  /** The shared tool names, for callers that only need the catalogue. */
  static get allToolNames() {
    return [...AI_TOOL_NAMES, ...AI_PROPOSAL_TOOL_NAMES];
  }
}

/** Which model the audit log records a tool event against. */
function assistantAuditModel(): { model: string | undefined; provider: string } {
  const route = resolveAiRoute('assistant');
  if (route.kind === 'openai-compatible') return { model: route.model, provider: 'openai-compatible' };
  return { model: route.kind === 'azure-openai' ? route.model ?? undefined : undefined, provider: 'azure' };
}

function createTool(definition: AiToolDefinition<never>, context: AssistantToolContext, toolContext: AiToolContext) {
  return tool({
    description: definition.description,
    execute: async (input: unknown) => {
      const result = AssistantRedactionService.redact(await executeAiTool(definition, input, toolContext));
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
          toolName: definition.name,
        },
        ...assistantAuditModel(),
        tenantKey: context.tenantKey,
        toolName: definition.name,
      });
      return result;
    },
    inputSchema: definition.inputSchema as unknown as z.ZodType,
  });
}
