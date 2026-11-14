import { jsonSchema } from 'ai';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

/**
 * Runs the real AI SDK providers against a stubbed `fetch`, so an SDK upgrade that changes the
 * request a provider receives, or how the response is read back, fails here instead of in
 * production. One case per route kind, plus the shapes the features use: text, a schema, images.
 */

const AI_ENV_KEYS = [
  'AI_API_KEY',
  'AI_BASE_URL',
  'AI_MODEL',
  'AI_MODEL_CSV_MAPPING',
  'AI_MODEL_OCR',
  'AI_PROVIDER',
  'ANTHROPIC_API_KEY',
  'AZURE_AI_FOUNDRY_API_KEY',
  'AZURE_AI_FOUNDRY_API_VERSION',
  'AZURE_AI_FOUNDRY_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_DEPLOYMENT',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_OCR_DEPLOYMENT',
];

const schema = jsonSchema({
  additionalProperties: false,
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  type: 'object',
});

const completion = {
  choices: [{ finish_reason: 'stop', index: 0, message: { content: '{"answer":"ok"}', role: 'assistant' } }],
  created: 0,
  id: 'chatcmpl-1',
  model: 'gpt-5.4-nano',
  object: 'chat.completion',
  usage: { completion_tokens: 5, prompt_tokens: 20, total_tokens: 25 },
};

const anthropicMessage = {
  content: [{ text: '{"answer":"ok"}', type: 'text' }],
  id: 'msg_1',
  model: 'claude-sonnet-4-5',
  role: 'assistant',
  stop_reason: 'end_turn',
  stop_sequence: null,
  type: 'message',
  usage: { input_tokens: 20, output_tokens: 5 },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });
}

async function requestOf(fetchMock: Mock<typeof fetch>, call = 0) {
  const [input, init] = fetchMock.mock.calls[call] ?? [''];
  const request = new Request(input, init);
  return { body: (await request.json()) as Record<string, unknown>, headers: request.headers, url: new URL(request.url) };
}

describe('completeJson over the real SDK', () => {
  let fetchMock: Mock<typeof fetch>;

  beforeEach(() => {
    vi.resetModules();
    for (const key of AI_ENV_KEYS) vi.stubEnv(key, undefined);
    fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(completion)));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reports the feature as disabled, without a request, when no provider is configured', async () => {
    const { completeJson } = await import('../complete-json');

    await expect(completeJson({ feature: 'csvMapping', schema, user: 'hello' })).rejects.toMatchObject({ code: 'feature_disabled', status: 501 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a text prompt to the Azure deployment and returns the object and token usage', async () => {
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
    vi.stubEnv('AZURE_OPENAI_API_VERSION', '2024-08-01-preview');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://example.openai.azure.com/');
    const { completeJson } = await import('../complete-json');

    await expect(completeJson({ azureDeployment: 'gpt-5.4-nano', feature: 'csvMapping', schema, schemaName: 'column_mapping', system: 'map the columns', temperature: 0, user: '{"headers":["Date"]}' })).resolves.toEqual({
      object: { answer: 'ok' },
      tokens: { completionTokens: 5, promptTokens: 20, totalTokens: 25 },
    });

    const { body, headers, url } = await requestOf(fetchMock);
    expect(url.origin).toBe('https://example.openai.azure.com');
    expect(url.pathname).toBe('/openai/deployments/gpt-5.4-nano/chat/completions');
    expect(url.searchParams.get('api-version')).toBe('2024-08-01-preview');
    expect(headers.get('api-key')).toBe('azure-key');
    expect(body['model']).toBe('gpt-5.4-nano');
    expect(body['response_format']).toMatchObject({ json_schema: { name: 'column_mapping' }, type: 'json_schema' });
    // The SDK may send the instruction as a `system` or `developer` message depending on the model.
    const [instruction, userMessage] = body['messages'] as { content: string; role: string }[];
    expect(instruction?.content).toBe('map the columns');
    expect(userMessage).toEqual({ content: '{"headers":["Date"]}', role: 'user' });
  });

  it('sends an OCR vision request to the Azure OCR deployment', async () => {
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
    vi.stubEnv('AZURE_OPENAI_API_VERSION', '2024-08-01-preview');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://example.openai.azure.com');
    vi.stubEnv('AZURE_OPENAI_OCR_DEPLOYMENT', 'ocr-deployment');
    const { completeJson } = await import('../complete-json');

    await expect(completeJson({ feature: 'ocr', images: [{ data: 'aGVsbG8=', mediaType: 'image/png' }], schema, schemaName: 'receipt', user: 'read the receipt' })).resolves.toMatchObject({ object: { answer: 'ok' } });

    const { body, url } = await requestOf(fetchMock);
    expect(url.pathname).toBe('/openai/deployments/ocr-deployment/chat/completions');
    expect(body['model']).toBe('ocr-deployment');
    const [message] = body['messages'] as { content: { image_url?: { url: string }; type: string }[] }[];
    expect(message?.content.find((part) => part.type === 'image_url')?.image_url?.url).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('sends a text prompt to an OpenAI-compatible endpoint with the configured model', async () => {
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1/');
    vi.stubEnv('AI_MODEL', 'llama3.1');
    vi.stubEnv('AI_API_KEY', 'local-key');
    const { completeJson } = await import('../complete-json');

    await expect(completeJson({ azureDeployment: 'ignored-off-azure', feature: 'monthlyStory', schema, user: 'polish this' })).resolves.toEqual({
      object: { answer: 'ok' },
      tokens: { completionTokens: 5, promptTokens: 20, totalTokens: 25 },
    });

    const { body, headers, url } = await requestOf(fetchMock);
    expect(url.href).toBe('http://localhost:11434/v1/chat/completions');
    expect(headers.get('authorization')).toBe('Bearer local-key');
    expect(body['model']).toBe('llama3.1');
  });

  it('sends a text prompt to Anthropic and reads its usage', async () => {
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.stubEnv('AI_MODEL', 'claude-sonnet-4-5');
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(anthropicMessage)));
    const { completeJson } = await import('../complete-json');

    await expect(completeJson({ feature: 'enrichment', model: 'claude-opus-4-5', schema, schemaName: 'transaction_enrichment', system: 'classify', user: '{"candidateText":"ACME"}' })).resolves.toEqual({
      object: { answer: 'ok' },
      tokens: { completionTokens: 5, promptTokens: 20, totalTokens: 25 },
    });

    const { body, headers, url } = await requestOf(fetchMock);
    expect(url.href).toBe('https://api.anthropic.com/v1/messages');
    expect(headers.get('x-api-key')).toBe('sk-ant-test');
    expect(headers.get('anthropic-version')).not.toBeNull();
    // The caller's model (enrichment's TRANSACTION_ENRICHMENT_GPT_MODEL_VERSION) wins over AI_MODEL.
    expect(body['model']).toBe('claude-opus-4-5');
    expect(body['messages']).toEqual([{ content: [{ text: '{"candidateText":"ACME"}', type: 'text' }], role: 'user' }]);
    expect(body['system']).toEqual([expect.objectContaining({ text: 'classify' })]);
  });

  it('sends an OCR image to Anthropic', async () => {
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.stubEnv('AI_MODEL_OCR', 'claude-haiku-4-5');
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(anthropicMessage)));
    const { completeJson } = await import('../complete-json');

    await completeJson({ feature: 'ocr', images: [{ data: 'aGVsbG8=', mediaType: 'image/png' }], schema, user: 'read the receipt' });

    const { body } = await requestOf(fetchMock);
    const [message] = body['messages'] as { content: { source?: { data: string; media_type: string; type: string }; type: string }[] }[];
    expect(message?.content.find((part) => part.type === 'image')?.source).toEqual({ data: 'aGVsbG8=', media_type: 'image/png', type: 'base64' });
  });

  it('sends enrichment to the Foundry model-inference endpoint with its api-version', async () => {
    vi.stubEnv('AZURE_AI_FOUNDRY_API_KEY', 'foundry-key');
    vi.stubEnv('AZURE_AI_FOUNDRY_API_VERSION', '2024-05-01-preview');
    vi.stubEnv('AZURE_AI_FOUNDRY_ENDPOINT', 'https://example.services.ai.azure.com');
    const { completeJson } = await import('../complete-json');

    await expect(completeJson({ feature: 'enrichment', model: 'DeepSeek-V4-Flash', schema, user: 'classify' })).resolves.toMatchObject({ object: { answer: 'ok' } });

    const { body, headers, url } = await requestOf(fetchMock);
    expect(url.origin).toBe('https://example.services.ai.azure.com');
    expect(url.pathname).toBe('/models/chat/completions');
    expect(url.searchParams.get('api-version')).toBe('2024-05-01-preview');
    expect(headers.get('api-key')).toBe('foundry-key');
    expect(body['model']).toBe('DeepSeek-V4-Flash');
  });

  it('surfaces a provider rejection as an error carrying the HTTP status, without retrying enrichment', async () => {
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('AI_MODEL', 'llama3.1');
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ error: { message: 'rate limited', type: 'rate_limit_error' } }, 429)));
    const { AiCompletionError, completeJson } = await import('../complete-json');

    const error = await completeJson({ feature: 'enrichment', schema, user: 'classify' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiCompletionError);
    expect((error as InstanceType<typeof AiCompletionError>).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an empty answer distinctly from a malformed one', async () => {
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('AI_MODEL', 'llama3.1');
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ...completion, choices: [{ finish_reason: 'stop', index: 0, message: { content: '', role: 'assistant' } }] })));
    const { AiCompletionError, completeJson } = await import('../complete-json');

    const empty = await completeJson({ feature: 'csvMapping', schema, user: 'map' }).catch((caught: unknown) => caught);
    expect(empty).toBeInstanceOf(AiCompletionError);
    expect((empty as InstanceType<typeof AiCompletionError>).empty).toBe(true);

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ ...completion, choices: [{ finish_reason: 'stop', index: 0, message: { content: 'not json', role: 'assistant' } }] })));
    const malformed = await completeJson({ feature: 'csvMapping', schema, user: 'map' }).catch((caught: unknown) => caught);
    expect(malformed).toBeInstanceOf(AiCompletionError);
    expect((malformed as InstanceType<typeof AiCompletionError>).empty).toBe(false);
  });
});
