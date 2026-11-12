import { AI_PROPOSAL_TOOL_NAMES } from '@service/ai-tools/ai-proposal-tools.service';
import { AI_TOOL_NAMES } from '@service/ai-tools/ai-tools.service';

/**
 * The tools the assistant may call: every read tool and every `propose_*` tool. One list with the
 * shared tool layer, so a tool cannot be added to the MCP server and silently stay unreachable in
 * the chat (or the reverse).
 */
const DEFAULT_ALLOWED_TOOLS = [...AI_TOOL_NAMES, ...AI_PROPOSAL_TOOL_NAMES];

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
