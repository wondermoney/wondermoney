/**
 * Per-token cap on MCP tool calls.
 *
 * The `apiToken` rate-limit family bounds *HTTP requests* per token. One JSON-RPC request can
 * carry several `tools/call` messages, and a client that batches calls would otherwise get an
 * unbounded number of database reads through one request. This is a second, tool-level budget,
 * counted per token in a one-minute window.
 *
 * It is per-process and in memory, like the breach counters in `middleware/rate-limit.ts`: the
 * cap is a runaway-loop guard, not an accounting figure, so a deploy resetting it is harmless.
 */
export const DEFAULT_MCP_TOOL_CALLS_PER_MINUTE = 60;
const WINDOW_MS = 60 * 1000;

interface ToolCallWindow {
  count: number;
  start: number;
}

const windows = new Map<number, ToolCallWindow>();

export function mcpToolCallsPerMinute(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const configured = Number.parseInt(env['MCP_TOOL_CALLS_PER_MINUTE'] ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MCP_TOOL_CALLS_PER_MINUTE;
}

/** Count one tool call for `apiTokenKey`; false when this token is over its minute budget. */
export function consumeMcpToolCall(apiTokenKey: number, now = Date.now()): boolean {
  const current = windows.get(apiTokenKey);
  if (!current || now - current.start >= WINDOW_MS) {
    windows.set(apiTokenKey, { count: 1, start: now });
    return true;
  }
  if (current.count >= mcpToolCallsPerMinute()) return false;
  current.count += 1;
  return true;
}

/** Exported for tests: drops the accumulated windows. */
export function resetMcpToolCallWindows(): void {
  windows.clear();
}
