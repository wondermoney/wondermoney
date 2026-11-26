/**
 * Per-token cap on MCP tool calls.
 *
 * The `apiToken` rate-limit family bounds *HTTP requests* per token. One JSON-RPC request can
 * carry several `tools/call` messages, and a client that batches calls would otherwise get an
 * unbounded number of database reads through one request. This is a second, tool-level budget,
 * counted per credential in a one-minute window.
 *
 * It is per-process and in memory, like the breach counters in `middleware/rate-limit.ts`: the
 * cap is a runaway-loop guard, not an accounting figure, so a deploy resetting it is harmless.
 *
 * With OAuth there is a window per person and client, and anyone can register a client, so the
 * map must not keep every pair it has seen. The map is kept in the order the windows started
 * (a window that restarts moves to the end), so each check drops the ended windows from the
 * front and stops at the first open one: the map holds the last minute's callers. Past
 * `MAX_MCP_TOOL_CALL_WINDOWS` of those, the oldest open window goes too; that caller starts a
 * fresh window, which costs at most one extra minute's budget, only under a flood of callers.
 */
export const DEFAULT_MCP_TOOL_CALLS_PER_MINUTE = 60;
const WINDOW_MS = 60 * 1000;

/** The most windows kept at once, whatever the number of callers in a minute. */
export const MAX_MCP_TOOL_CALL_WINDOWS = 50_000;

interface ToolCallWindow {
  count: number;
  start: number;
}

/** Credential key to its window, in the order the windows started. */
const windows = new Map<string, ToolCallWindow>();

export function mcpToolCallsPerMinute(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const configured = Number.parseInt(env['MCP_TOOL_CALLS_PER_MINUTE'] ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MCP_TOOL_CALLS_PER_MINUTE;
}

function evictEndedWindows(now: number): void {
  for (const [key, window] of windows) {
    if (now - window.start < WINDOW_MS) return;
    windows.delete(key);
  }
}

/**
 * Count one tool call for a credential (`mcpCredentialKey`: a personal token, or one person's
 * OAuth grant to one client); false when it is over its minute budget.
 */
export function consumeMcpToolCall(credentialKey: string, now = Date.now()): boolean {
  evictEndedWindows(now);
  const current = windows.get(credentialKey);
  if (!current || now - current.start >= WINDOW_MS) {
    windows.delete(credentialKey);
    windows.set(credentialKey, { count: 1, start: now });
    if (windows.size > MAX_MCP_TOOL_CALL_WINDOWS) {
      const oldest = windows.keys().next();
      if (!oldest.done) windows.delete(oldest.value);
    }
    return true;
  }
  if (current.count >= mcpToolCallsPerMinute()) return false;
  current.count += 1;
  return true;
}

/** Exported for tests: how many windows the map holds. */
export function mcpToolCallWindowCount(): number {
  return windows.size;
}

/** Exported for tests: drops the accumulated windows. */
export function resetMcpToolCallWindows(): void {
  windows.clear();
}
