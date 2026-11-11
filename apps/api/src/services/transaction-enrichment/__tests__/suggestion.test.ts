import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTransactionEnrichmentPrompt } from '../prompt';

const mocked = vi.hoisted(() => ({
  completeJson: vi.fn(),
}));

vi.mock('@service/ai/complete-json', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@service/ai/complete-json')>();
  return { ...actual, completeJson: mocked.completeJson };
});

const tokens = { completionTokens: 2, promptTokens: 3, totalTokens: 5 };

describe('transaction enrichment suggestion', () => {
  beforeEach(() => {
    vi.resetModules();
    mocked.completeJson.mockReset();
  });

  it('imports without any AI env', async () => {
    delete process.env['AZURE_AI_FOUNDRY_API_KEY'];
    delete process.env['AZURE_AI_FOUNDRY_API_VERSION'];
    delete process.env['AZURE_AI_FOUNDRY_ENDPOINT'];

    await expect(import('../suggestion')).resolves.toBeDefined();
  });

  it('builds the expected request and parses valid responses', async () => {
    const prompt = buildTransactionEnrichmentPrompt({ candidateText: 'MB WAY transfer', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit', promptVersion: 'v1' });
    mocked.completeJson.mockResolvedValue({ object: { categorySuggestionKey: 1, confidence: 0.9, inputId: prompt.inputId, merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' }, tokens });

    const { requestTransactionEnrichmentSuggestion } = await import('../suggestion');

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

    expect(mocked.completeJson).toHaveBeenCalledWith(expect.objectContaining({
      feature: 'enrichment',
      model: 'DeepSeek-V4-Flash',
      schemaName: 'transaction_enrichment',
      system: expect.any(String),
      temperature: 0,
      user: expect.any(String),
    }));
  });

  it('rejects an empty answer as missing and a malformed one as invalid', async () => {
    const { AiCompletionError } = await import('@service/ai/complete-json');
    const { requestTransactionEnrichmentSuggestion } = await import('../suggestion');
    const baseInput = { candidateText: 'Safe text', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit' as const, modelVersion: 'DeepSeek-V4-Flash', promptVersion: 'v1' };

    mocked.completeJson.mockRejectedValueOnce(new AiCompletionError('No object generated', { empty: true }));
    await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toThrow('transaction enrichment response missing');

    mocked.completeJson.mockRejectedValueOnce(new AiCompletionError('No object generated', { text: '{' }));
    await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toThrow('transaction enrichment invalid response');
  });

  it('keeps the HTTP status of a transport failure so the worker can retry it', async () => {
    const { AiCompletionError } = await import('@service/ai/complete-json');
    const { requestTransactionEnrichmentSuggestion } = await import('../suggestion');
    const baseInput = { candidateText: 'Safe text', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit' as const, modelVersion: 'DeepSeek-V4-Flash', promptVersion: 'v1' };

    mocked.completeJson.mockRejectedValueOnce(new AiCompletionError('Model request failed with status 429', { status: 429 }));

    await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toMatchObject({ status: 429 });
  });

  it('rejects echo mismatch, unknown fields, an invalid category, an unsafe merchant and an empty answer', async () => {
    const { requestTransactionEnrichmentSuggestion } = await import('../suggestion');
    const prompt = buildTransactionEnrichmentPrompt({ candidateText: 'Safe text', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit', promptVersion: 'v1' });
    const baseInput = { candidateText: 'Safe text', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit' as const, modelVersion: 'DeepSeek-V4-Flash', promptVersion: 'v1' };

    for (const object of [
      { categorySuggestionKey: 1, confidence: 0.9, inputId: 'b'.repeat(64), merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' },
      { categorySuggestionKey: 1, confidence: 0.9, extra: true, inputId: prompt.inputId, merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' },
      { categorySuggestionKey: 99, confidence: 0.9, inputId: prompt.inputId, merchantSuggestion: 'ACME', reasonCode: 'merchant_suggested' },
      { categorySuggestionKey: 1, confidence: 0.9, inputId: prompt.inputId, merchantSuggestion: 'MB WAY transfer', reasonCode: 'merchant_suggested' },
    ]) {
      mocked.completeJson.mockResolvedValueOnce({ object, tokens });
      await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toThrow('transaction enrichment invalid response');
    }
  });

  it('does not expose model response fragments in parser errors', async () => {
    const { requestTransactionEnrichmentSuggestion } = await import('../suggestion');
    const prompt = buildTransactionEnrichmentPrompt({ candidateText: 'Safe text', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit', promptVersion: 'v1' });
    const baseInput = { candidateText: 'Safe text', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'debit' as const, modelVersion: 'DeepSeek-V4-Flash', promptVersion: 'v1' };

    mocked.completeJson.mockResolvedValueOnce({ object: { categorySuggestionKey: 1, confidence: 0.9, inputId: prompt.inputId, merchantSuggestion: 'ACME', reasonCode: 'IBAN PT50 0000 0000' }, tokens });
    await expect(requestTransactionEnrichmentSuggestion(baseInput)).rejects.toThrow(/^transaction enrichment invalid response$/);
  });

  it('nulls unsafe candidate text and omits sensitive request details', async () => {
    const prompt = buildTransactionEnrichmentPrompt({ candidateText: 'IBAN PT50 0000 0000 0000 0000 0000 1', categories: [{ categoryKey: 1, label: 'Groceries' }], direction: 'unknown', promptVersion: 'v1' });
    mocked.completeJson.mockResolvedValue({ object: { categorySuggestionKey: null, confidence: 0.1, inputId: prompt.inputId, merchantSuggestion: null, reasonCode: 'no_suggestion' }, tokens });

    const { requestTransactionEnrichmentSuggestion } = await import('../suggestion');

    await requestTransactionEnrichmentSuggestion({
      candidateText: 'IBAN PT50 0000 0000 0000 0000 0000 1',
      categories: [{ categoryKey: 1, label: 'Groceries' }],
      direction: 'unknown',
      modelVersion: 'DeepSeek-V4-Flash',
      promptVersion: 'v1',
    });

    const requestPayload = mocked.completeJson.mock.calls[0]?.[0];
    expect(requestPayload).toBeDefined();
    if (!requestPayload) throw new Error('missing request payload');
    const userPrompt = String(requestPayload.user);
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
