import { beforeEach, describe, expect, it } from 'vitest';

import {
  consumeMcpToolCall,
  DEFAULT_MCP_TOOL_CALLS_PER_MINUTE,
  MAX_MCP_TOOL_CALL_WINDOWS,
  mcpToolCallWindowCount,
  resetMcpToolCallWindows,
} from '@service/mcp/mcp-rate-limit.service';

const MINUTE = 60 * 1000;
const T0 = Date.parse('2026-11-26T12:00:00Z');
/** One person's OAuth grant to one client, as `mcpCredentialKey` names it. */
const pair = (client: number, person: number) => `oauth:client-${client}:person-${person}`;

describe('the MCP tool-call budget', () => {
  beforeEach(() => {
    resetMcpToolCallWindows();
  });

  it('allows the minute budget per credential, then refuses until the minute is over', () => {
    for (let call = 0; call < DEFAULT_MCP_TOOL_CALLS_PER_MINUTE; call += 1) {
      expect(consumeMcpToolCall(pair(1, 1), T0 + call)).toBe(true);
    }
    expect(consumeMcpToolCall(pair(1, 1), T0 + 1000)).toBe(false);
    // Another person on the same client has a budget of their own.
    expect(consumeMcpToolCall(pair(1, 2), T0 + 1000)).toBe(true);
    expect(consumeMcpToolCall(pair(1, 1), T0 + MINUTE)).toBe(true);
  });

  it('forgets the windows that are over, so the map holds only the last minute of callers', () => {
    for (let client = 0; client < 100; client += 1) {
      for (let person = 0; person < 100; person += 1) consumeMcpToolCall(pair(client, person), T0 + client);
    }
    expect(mcpToolCallWindowCount()).toBe(10_000);

    consumeMcpToolCall(pair(200, 200), T0 + 30_000);
    expect(mcpToolCallWindowCount()).toBe(10_001);

    // A minute after the last of the first ones started, they are all gone; the later one stays.
    consumeMcpToolCall(pair(500, 500), T0 + 99 + MINUTE);
    expect(mcpToolCallWindowCount()).toBe(2);
  });

  it('stays under its ceiling when more pairs than that call within one minute', () => {
    const pairs = MAX_MCP_TOOL_CALL_WINDOWS + 5_000;
    for (let index = 0; index < pairs; index += 1) {
      expect(consumeMcpToolCall(pair(index % 977, index), T0 + Math.floor(index / 1_000))).toBe(true);
      expect(mcpToolCallWindowCount()).toBeLessThanOrEqual(MAX_MCP_TOOL_CALL_WINDOWS);
    }
    // The newest callers keep their windows and their counts.
    const newest = pair((pairs - 1) % 977, pairs - 1);
    for (let call = 1; call < DEFAULT_MCP_TOOL_CALLS_PER_MINUTE; call += 1) consumeMcpToolCall(newest, T0 + 100);
    expect(consumeMcpToolCall(newest, T0 + 100)).toBe(false);
  });

  it('keeps counting a window that is still open when a later caller clears the old ones', () => {
    for (let call = 0; call < DEFAULT_MCP_TOOL_CALLS_PER_MINUTE; call += 1) consumeMcpToolCall(pair(1, 1), T0 + 30_000);
    consumeMcpToolCall(pair(2, 2), T0);
    // pair(2, 2)'s window has ended; pair(1, 1)'s, started later, has not.
    consumeMcpToolCall(pair(3, 3), T0 + MINUTE + 1);
    expect(consumeMcpToolCall(pair(1, 1), T0 + MINUTE + 2)).toBe(false);
  });
});
