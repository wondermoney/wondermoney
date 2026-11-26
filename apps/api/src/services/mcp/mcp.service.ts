import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';

import { DI } from '@app/app';
import { AssistantAuditEventType, AssistantAuditSource } from '@entity/AssistantAuditLog';
import { AI_PROPOSAL_TOOL_DEFINITIONS } from '@service/ai-tools/ai-proposal-tools.service';
import { type AiToolContext, executeAiTool } from '@service/ai-tools/ai-tool-types';
import { AI_TOOL_DEFINITIONS } from '@service/ai-tools/ai-tools.service';
import { AssistantAuditService } from '@service/assistant/assistant-audit.service';
import { buildInfo } from '@utils/constants';
import logger from '@utils/logger';

import { consumeMcpToolCall } from './mcp-rate-limit.service';
import { mcpCredentialKey, type McpRequestIdentity } from './mcp-types';

/**
 * The MCP server: the read tools for a caller with `mcp:read`, the `propose_*` tools for a personal
 * API token with `mcp:propose`. A proposal only waits for the person to apply it in the app; no
 * MCP tool, and no token, can apply one. An OAuth client (ChatGPT) is only ever granted
 * `mcp:read`.
 *
 * Every read tool is annotated read-only and returns its data twice: as `structuredContent` for
 * clients that read structured results (the ChatGPT Apps SDK), and as JSON text for the rest.
 *
 * Stateless Streamable HTTP: every POST gets a fresh `McpServer` and transport, so there is no
 * server-side session to leak between callers and no state to expire. The caller is resolved
 * from their personal API token or OAuth access token before this runs (`middleware/mcp-auth.ts`),
 * and every tool reads through the request EntityManager, so the tenant filter and its
 * per-account privacy carve-out apply exactly as they do for the assistant.
 */
export function createMcpServer(identity: McpRequestIdentity): McpServer {
  const { version } = buildInfo();
  const server = new McpServer({ name: 'wondermoney', version });
  const context: AiToolContext = {
    appuserKey: identity.appuser.appuserKey,
    currency: identity.appuser.currencyKey.code || 'EUR',
    origin: identity.credential.kind === 'api_token' ? { apiTokenKey: identity.credential.apiTokenKey, source: 'mcp' } : { source: 'mcp' },
    tenantKey: identity.tenant.tenantKey,
  };

  const definitions = [
    ...(identity.scopes.includes('mcp:read') ? AI_TOOL_DEFINITIONS.map((definition) => ({ definition, readOnly: true })) : []),
    ...(identity.scopes.includes('mcp:propose') ? AI_PROPOSAL_TOOL_DEFINITIONS.map((definition) => ({ definition, readOnly: false })) : []),
  ];
  const credentialKey = mcpCredentialKey(identity.credential);
  for (const { definition, readOnly } of definitions) {
    server.registerTool(
      definition.name,
      {
        // A proposal tool writes nothing the person has not confirmed, but it does record a
        // pending change, so only the read tools claim to be read-only.
        annotations: readOnly
          ? { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true }
          : { destructiveHint: false, idempotentHint: false, openWorldHint: false, readOnlyHint: false },
        description: definition.description,
        inputSchema: definition.inputSchema,
      },
      async (input) => {
        if (!consumeMcpToolCall(credentialKey)) {
          await audit(identity, definition.name, AssistantAuditEventType.TOOL_DENIED, { status: 'rate_limited' });
          return toolError('Too many tool calls for this token. Try again in a minute.');
        }

        try {
          const result = await executeAiTool(definition, input, context);
          await audit(identity, definition.name, AssistantAuditEventType.TOOL_CALLED, {
            granularity: result.dataUsed.granularity,
            period: result.dataUsed.period,
            recordCount: result.dataUsed.recordCount,
            source: result.dataUsed.source,
            status: 'completed',
          });
          return {
            content: [{ text: JSON.stringify(result.data), type: 'text' as const }],
            structuredContent: toStructuredContent(result.data),
          };
        } catch (error) {
          logger.error({ err: error, toolName: definition.name }, 'MCP tool call failed');
          await audit(identity, definition.name, AssistantAuditEventType.ERROR, { status: 'failed' });
          return toolError('The tool could not answer that request.');
        }
      },
    );
  }

  return server;
}

/**
 * Answer one Streamable HTTP request. Stateless: the transport is created for this request and
 * closed when the response closes.
 */
export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const identity = req.mcpIdentity;
  if (!identity) {
    res.status(401).json(jsonRpcError(-32001, 'Unauthorized'));
    return;
  }

  const server = createMcpServer(identity);
  const transport = new StreamableHTTPServerTransport({
    // A plain JSON response keeps the endpoint usable from clients that do not read SSE and
    // makes a tool call one request/response pair.
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error({ err: error }, 'MCP request failed');
    if (!res.headersSent) res.status(500).json(jsonRpcError(-32603, 'Internal server error'));
  }
}

/** GET and DELETE have no meaning for a stateless server; answer the spec's 405 shape. */
export function methodNotAllowed(_req: Request, res: Response): void {
  res.status(405).json(jsonRpcError(-32000, 'Method not allowed.'));
}

/** MCP's `structuredContent` is a JSON object; a tool whose data is anything else is wrapped. */
async function audit(
  identity: McpRequestIdentity,
  toolName: string,
  eventType: AssistantAuditEventType,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { credential } = identity;
  await AssistantAuditService.log(DI.em, {
    ...(credential.kind === 'api_token' ? { apiTokenKey: credential.apiTokenKey } : { oauthClientId: credential.clientId }),
    appuserKey: identity.appuser.appuserKey,
    // One conversation per credential: the audit log's `conversation_id` groups an MCP client's
    // calls, by personal token or by OAuth client.
    conversationId: credential.kind === 'api_token' ? `mcp:${credential.apiTokenKey}` : `mcp:oauth:${credential.clientId}`,
    eventType,
    metadata: { ...metadata, toolName },
    source: AssistantAuditSource.MCP,
    tenantKey: identity.tenant.tenantKey,
    toolName,
  });
}

function jsonRpcError(code: number, message: string) {
  return { error: { code, message }, id: null, jsonrpc: '2.0' as const };
}

function toolError(message: string) {
  return { content: [{ text: message, type: 'text' as const }], isError: true };
}

function toStructuredContent(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : { result: data };
}
