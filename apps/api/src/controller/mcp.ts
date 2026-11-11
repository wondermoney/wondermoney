import type { Request, Response } from 'express';
import { z } from 'zod';

import { DI } from '@app/database/di';
import { AssistantAuditLog, AssistantAuditSource } from '@entity/AssistantAuditLog';
import { authedContext } from '@middleware/authed-context';
import { zParse } from '@validators/parser';

const mcpCallsQuerySchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }).strict(),
});

/**
 * `GET /v1/user/mcp-calls` — the signed-in member's recent MCP tool calls.
 *
 * The settings panel shows the tool name and when it ran. Amounts, descriptions and the
 * token's own value are deliberately absent: the audit row never stores them (`source = 'mcp'`,
 * `tool_name`, a safe metadata whitelist).
 */
export async function listMcpCalls(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const {
    query: { limit },
  } = await zParse(mcpCallsQuerySchema, req);
  const calls = await DI.em.find(
    AssistantAuditLog,
    {
      appuserKey: user,
      deletedAt: null,
      source: AssistantAuditSource.MCP,
      tenantKey: tenant,
    },
    { limit, orderBy: { createdAt: 'desc' } },
  );
  return res.json({
    calls: calls.map((call) => ({
      createdAt: call.createdAt.toISOString(),
      toolName: call.toolName ?? null,
    })),
  });
}
