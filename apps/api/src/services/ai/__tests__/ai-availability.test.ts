import { describe, expect, it } from 'vitest';

import { effectiveAiCapabilities, isAiAllowedFor, isAiHidden } from '../ai-availability';

const ALL_ON = { AI_BASE_URL: 'http://localhost:11434/v1', AI_MODEL: 'llama3.1', AI_MODEL_STATEMENT_IMPORT: 'qwen2.5vl' };
const ALL_OFF = {};

const owner = (preferences: Record<string, unknown>) => ({ preferences });

describe('per-user AI availability', () => {
  it('reads the preference, defaulting to not hidden', () => {
    expect(isAiHidden(owner({}))).toBe(false);
    expect(isAiHidden(owner({ aiHidden: true }))).toBe(true);
    expect(isAiHidden(undefined)).toBe(false);
  });

  it('allows a feature only when the instance has it and the person has not hidden AI', () => {
    expect(isAiAllowedFor(owner({}), 'assistant', ALL_ON)).toBe(true);
    expect(isAiAllowedFor(owner({ aiHidden: true }), 'assistant', ALL_ON)).toBe(false);
    expect(isAiAllowedFor(owner({}), 'assistant', ALL_OFF)).toBe(false);
  });

  it('reports every feature off in the profile view once AI is hidden', () => {
    expect(effectiveAiCapabilities(owner({ aiHidden: true }), ALL_ON)).toEqual({
      assistant: false,
      csvMapping: false,
      enrichment: false,
      monthlyStory: false,
      ocr: false,
      statementImport: false,
    });
  });

  it('reports the instance capabilities unchanged when AI is not hidden', () => {
    expect(effectiveAiCapabilities(owner({}), ALL_ON)).toMatchObject({ assistant: true, ocr: true, statementImport: true });
    expect(effectiveAiCapabilities(owner({}), ALL_OFF)).toMatchObject({ assistant: false, ocr: false });
  });
});
