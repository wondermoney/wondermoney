import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('deepseek service', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env['AZURE_AI_FOUNDRY_API_KEY'];
    delete process.env['AZURE_AI_FOUNDRY_API_VERSION'];
    delete process.env['AZURE_AI_FOUNDRY_ENDPOINT'];
    delete process.env['AI_API_KEY'];
    delete process.env['AI_BASE_URL'];
    delete process.env['AI_MODEL'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports enrichment as disabled when no model provider is configured', async () => {
    const { default: DeepSeek } = await import('./deepseek');

    await expect(
      DeepSeek.promptWithText({
        messages: [{ content: 'hello', role: 'user' }],
        model: 'DeepSeek-V4-Flash',
        responseFormat: { json_schema: { name: 'x', schema: {}, strict: true }, type: 'json_schema' },
      }),
    ).rejects.toMatchObject({ code: 'feature_disabled' });
  });

  it('posts to an OpenAI-compatible endpoint with the requested model and a bearer key', async () => {
    process.env['AI_BASE_URL'] = 'https://openrouter.example/api/v1';
    process.env['AI_API_KEY'] = 'sk-test';
    process.env['AI_MODEL'] = 'some-default';

    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ choices: [{ message: { content: '{"ok":true}' } }], usage: { completion_tokens: 1, prompt_tokens: 2, total_tokens: 3 } }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    const { default: DeepSeek } = await import('./deepseek');

    await expect(DeepSeek.promptWithText({
      messages: [{ content: 'hello', role: 'user' }],
      model: 'qwen2.5',
      responseFormat: { json_schema: { name: 'x', schema: {}, strict: true }, type: 'json_schema' },
    })).resolves.toMatchObject({ answer: '{"ok":true}', tokens: 3 });

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe('https://openrouter.example/api/v1/chat/completions');
    expect(init.headers['Authorization']).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'qwen2.5' });
  });

  it('posts to the AI Foundry model-inference endpoint and returns usage counts', async () => {
    process.env['AZURE_AI_FOUNDRY_API_KEY'] = 'key';
    process.env['AZURE_AI_FOUNDRY_API_VERSION'] = '2024-05-01-preview';
    process.env['AZURE_AI_FOUNDRY_ENDPOINT'] = 'https://example.services.ai.azure.com';

    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { completion_tokens: 7, prompt_tokens: 11, total_tokens: 18 },
      }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { default: DeepSeek } = await import('./deepseek');

    await expect(
      DeepSeek.promptWithText({
        messages: [{ content: 'hello', role: 'user' }],
        model: 'DeepSeek-V4-Flash',
        responseFormat: { json_schema: { name: 'x', schema: {}, strict: true }, type: 'json_schema' },
        temperature: 0,
      }),
    ).resolves.toEqual({
      answer: '{"ok":true}',
      completionTokens: 7,
      promptTokens: 11,
      tokens: 18,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview',
      expect.objectContaining({
        body: JSON.stringify({
          messages: [{ content: 'hello', role: 'user' }],
          model: 'DeepSeek-V4-Flash',
          response_format: { json_schema: { name: 'x', schema: {}, strict: true }, type: 'json_schema' },
          temperature: 0,
        }),
        headers: { 'api-key': 'key', 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
  });

  it('throws when the request fails', async () => {
    process.env['AZURE_AI_FOUNDRY_API_KEY'] = 'key';
    process.env['AZURE_AI_FOUNDRY_API_VERSION'] = '2024-05-01-preview';
    process.env['AZURE_AI_FOUNDRY_ENDPOINT'] = 'https://example.services.ai.azure.com';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    const { default: DeepSeek } = await import('./deepseek');

    await expect(
      DeepSeek.promptWithText({
        messages: [{ content: 'hello', role: 'user' }],
        model: 'DeepSeek-V4-Flash',
        responseFormat: { json_schema: { name: 'x', schema: {}, strict: true }, type: 'json_schema' },
      }),
    ).rejects.toThrow('DeepSeek request failed with status 429');
  });

  it('throws a classifiable DeepSeekHttpError carrying the numeric status', async () => {
    process.env['AZURE_AI_FOUNDRY_API_KEY'] = 'key';
    process.env['AZURE_AI_FOUNDRY_API_VERSION'] = '2024-05-01-preview';
    process.env['AZURE_AI_FOUNDRY_ENDPOINT'] = 'https://example.services.ai.azure.com';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const { DeepSeekHttpError, default: DeepSeek } = await import('./deepseek');

    const error = await DeepSeek.promptWithText({
      messages: [{ content: 'hello', role: 'user' }],
      model: 'DeepSeek-V4-Flash',
      responseFormat: { json_schema: { name: 'x', schema: {}, strict: true }, type: 'json_schema' },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DeepSeekHttpError);
    expect((error as InstanceType<typeof DeepSeekHttpError>).status).toBe(503);
    expect((error as Error).message).toBe('DeepSeek request failed with status 503');
  });
});
