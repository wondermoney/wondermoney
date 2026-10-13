import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTransactionEnrichmentPrompt } from '../prompt';

const mocked = vi.hoisted(() => ({
  promptWithText: vi.fn(),
}));

vi.mock('@service/ai/deepseek', () => ({
  default: {
    promptWithText: mocked.promptWithText,
  },
}));

describe('transaction enrichment deepseek', () => {
  beforeEach(() => {
    vi.resetModules();
    mocked.promptWithText.mockReset();
  });

  it('imports without deepseek env', async () => {
    delete process.env['AZURE_AI_FOUNDRY_API_KEY'];
    delete process.env['AZURE_AI_FOUNDRY_API_VERSION'];
    delete process.env['AZURE_AI_FOUNDRY_ENDPOINT'];

    await expect(import('../deepseek')).resolves.toBeDefined();
  });

  it('builds the expected request and parses valid responses', async () => {
    const prompt = buildTransactionEnrichmentPrompt({ candidateText: 'MB WAY transfer', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit', promptVersion: 'v1' });
    mocked.promptWithText.mockResolvedValue({ answer: JSON.stringify({ categorySuggestionKey: 1, confidence: 0.9, inputId: prompt.inputId, merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' }), completionTokens: 2, promptTokens: 3, tokens: 5 });

    const { requestTransactionEnrichmentSuggestion } = await import('../deepseek');

    await expect(
      requestTransactionEnrichmentSuggestion({
        candidateText: 'MB WAY transfer',
        categories: [{ categoryKey: 1, label: 'Groceries' }],
        direction: 'debit',
        modelVersion: 'DeepSeek-V4-Flash',
        promptVersion: 'v1',
      }),
    ).resolves.toMatchObject({
      inputId: prompt.inputId,
      modelVersion: 'DeepSeek-V4-Flash',
      promptVersion: 'v1',
      result: { merchantSuggestion: 'ACME' },
      tokens: { completionTokens: 2, promptTokens: 3, totalTokens: 5 },
    });

    expect(mocked.promptWithText).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { content: expect.any(String), role: 'system' },
        { content: expect.any(String), role: 'user' },
      ],
      model: 'DeepSeek-V4-Flash',
      responseFormat: { json_schema: { name: 'transaction_enrichment', schema: expect.any(Object), strict: true }, type: 'json_schema' },
      temperature: 0,
    }));
  });

  it('rejects malformed json echo mismatch unknown fields invalid category unsafe merchant and empty answers', async () => {
    const { requestTransactionEnrichmentSuggestion } = await import('../deepseek');
    const prompt = buildTransactionEnrichmentPrompt({ candidateText: 'Safe text', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit', promptVersion: 'v1' });

    const baseInput = { candidateText: 'Safe text', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit' as const, modelVersion: 'DeepSeek-V4-Flash', promptVersion: 'v1' };

    mocked.promptWithText.mockResolvedValueOnce({ answer: '{', completionTokens: 0, promptTokens: 0, tokens: 0 });
    await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toThrow('transaction enrichment invalid response');

    mocked.promptWithText.mockResolvedValueOnce({ answer: JSON.stringify({ categorySuggestionKey: 1, confidence: 0.9, inputId: 'b'.repeat(64), merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' }), completionTokens: 0, promptTokens: 0, tokens: 0 });
    await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toThrow('transaction enrichment invalid response');

    mocked.promptWithText.mockResolvedValueOnce({ answer: JSON.stringify({ categorySuggestionKey: 1, confidence: 0.9, extra: true, inputId: prompt.inputId, merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' }), completionTokens: 0, promptTokens: 0, tokens: 0 });
    await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toThrow('transaction enrichment invalid response');

    mocked.promptWithText.mockResolvedValueOnce({ answer: JSON.stringify({ categorySuggestionKey: 99, confidence: 0.9, inputId: prompt.inputId, merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' }), completionTokens: 0, promptTokens: 0, tokens: 0 });
    await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toThrow('transaction enrichment invalid response');

    mocked.promptWithText.mockResolvedValueOnce({ answer: JSON.stringify({ categorySuggestionKey: 1, confidence: 0.9, inputId: prompt.inputId, merchantSuggestion: 'MB WAY transfer', reasonCode: 'merchant_suggested' }), completionTokens: 0, promptTokens: 0, tokens: 0 });
    await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toThrow('transaction enrichment invalid response');

    mocked.promptWithText.mockResolvedValueOnce({ answer: '   ', completionTokens: 0, promptTokens: 0, tokens: 0 });
    await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toThrow('transaction enrichment response missing');
  });

  it('does not expose model response fragments in parser errors', async () => {
    const { requestTransactionEnrichmentSuggestion } = await import('../deepseek');
    const prompt = buildTransactionEnrichmentPrompt({ candidateText: 'Safe text', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit', promptVersion: 'v1' });
    const baseInput = { candidateText: 'Safe text', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit' as const, modelVersion: 'DeepSeek-V4-Flash', promptVersion: 'v1' };

    mocked.promptWithText.mockResolvedValueOnce({ answer: JSON.stringify({ categorySuggestionKey: 1, confidence: 0.9, inputId: prompt.inputId, merchantSuggestion: 'ACME', reasonCode: 'IBAN PT50 0000 0000' }), completionTokens: 0, promptTokens: 0, tokens: 0 });
    await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toThrow(/^transaction enrichment invalid response$/);

    mocked.promptWithText.mockResolvedValueOnce({ answer: JSON.stringify({ categorySuggestionKey: 1, confidence: 0.9, 'IBAN PT50 0000 0000': true, inputId: prompt.inputId, merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' }), completionTokens: 0, promptTokens: 0, tokens: 0 });
    await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toThrow(/^transaction enrichment invalid response$/);
  });

  it('nulls unsafe candidate text and omits sensitive request details', async () => {
    const prompt = buildTransactionEnrichmentPrompt({ candidateText: 'IBAN PT50 0000 0000 0000 0000 0000 1', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'unknown', promptVersion: 'v1' });
    mocked.promptWithText.mockResolvedValue({ answer: JSON.stringify({ categorySuggestionKey: null, confidence: 0.1, inputId: prompt.inputId, merchantSuggestion: null, reasonCode: 'no_suggestion' }), completionTokens: 0, promptTokens: 0, tokens: 0 });

    const { requestTransactionEnrichmentSuggestion } = await import('../deepseek');

    await requestTransactionEnrichmentSuggestion({
      candidateText: 'IBAN PT50 0000 0000 0000 0000 0000 1',
      categories: [{ categoryKey: 1, label: 'Groceries' }],
      direction: 'unknown',
      modelVersion: 'DeepSeek-V4-Flash',
      promptVersion: 'v1',
    });

    const requestPayload = mocked.promptWithText.mock.calls[0]?.[0];
    expect(requestPayload).toBeDefined();
    if (!requestPayload) throw new Error('missing request payload');
    const userPrompt = String(requestPayload.messages[1]?.content);
    const serializedRequest = JSON.stringify(requestPayload);
    expect(userPrompt).toContain('"candidateText":null');
    expect(serializedRequest).not.toContain('PT50');
    expect(serializedRequest).not.toContain('0000 0000');
    expect(userPrompt).not.toContain('tenant');
    expect(userPrompt).not.toContain('account');
    expect(userPrompt).not.toContain('balance');
    expect(userPrompt).not.toContain('user');
    expect(userPrompt).not.toContain('notes');
    expect(userPrompt).not.toContain('raw description');
  });
});
