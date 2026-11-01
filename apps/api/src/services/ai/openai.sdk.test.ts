import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

// Runs the real `openai` SDK (unlike `openai.test.ts`, which replaces it) against a stubbed
// `fetch`, so an SDK upgrade that changes the request the providers receive, or how the response
// is read back, fails here instead of in production.

const AI_ENV_KEYS = [
  'AI_API_KEY',
  'AI_BASE_URL',
  'AI_MODEL',
  'AI_MODEL_CSV_MAPPING',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_OCR_DEPLOYMENT',
];

const completion = {
  choices: [{ finish_reason: 'stop', index: 0, message: { content: '{"settlementAmount":12.5}', role: 'assistant' } }],
  created: 0,
  id: 'chatcmpl-1',
  model: 'gpt-5.4-nano',
  object: 'chat.completion',
  usage: { completion_tokens: 5, prompt_tokens: 20, total_tokens: 25 },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });
}

async function requestOf(fetchMock: Mock<typeof fetch>, call = 0) {
  const [input, init] = fetchMock.mock.calls[call] ?? [''];
  const request = new Request(input, init);
  return { body: (await request.json()) as Record<string, unknown>, headers: request.headers, url: new URL(request.url) };
}

describe('openai service over the real SDK', () => {
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

  it('sends an OCR vision request to the Azure deployment and returns the answer and token count', async () => {
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'azure-key');
    vi.stubEnv('AZURE_OPENAI_API_VERSION', '2024-08-01-preview');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://example.openai.azure.com/');
    vi.stubEnv('AZURE_OPENAI_OCR_DEPLOYMENT', 'ocr-deployment');
    const { default: OpenAI } = await import('./openai');

    await expect(OpenAI.processReceipt(['aGVsbG8='], 'image/png')).resolves.toEqual({
      answer: '{"settlementAmount":12.5}',
      tokens: 25,
    });

    const { body, headers, url } = await requestOf(fetchMock);
    expect(url.origin).toBe('https://example.openai.azure.com');
    expect(url.pathname).toBe('/openai/deployments/ocr-deployment/chat/completions');
    expect(url.searchParams.get('api-version')).toBe('2024-08-01-preview');
    expect(headers.get('api-key')).toBe('azure-key');
    expect(body['model']).toBe('ocr-deployment');
    expect(body['response_format']).toMatchObject({ json_schema: { name: 'transaction_information' }, type: 'json_schema' });
    const [message] = body['messages'] as { content: { image_url?: { url: string }; type: string }[] }[];
    expect(message?.content.find((part) => part.type === 'image_url')?.image_url?.url).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('sends a text prompt to an OpenAI-compatible endpoint with the configured model', async () => {
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1/');
    vi.stubEnv('AI_MODEL', 'llama3.1');
    vi.stubEnv('AI_API_KEY', 'local-key');
    const { default: OpenAI } = await import('./openai');

    await expect(
      OpenAI.promptWithText({
        feature: 'csvMapping',
        messages: [{ content: 'map these columns', role: 'user' }],
        model: 'ignored-off-azure',
        responseFormat: { type: 'json_object' },
        temperature: 0,
      }),
    ).resolves.toEqual({ answer: '{"settlementAmount":12.5}', completionTokens: 5, promptTokens: 20, tokens: 25 });

    const { body, headers, url } = await requestOf(fetchMock);
    expect(url.href).toBe('http://localhost:11434/v1/chat/completions');
    expect(headers.get('authorization')).toBe('Bearer local-key');
    expect(body).toMatchObject({ model: 'llama3.1', response_format: { type: 'json_object' }, temperature: 0 });
  });

  it('surfaces a provider rejection as an error carrying the HTTP status, without retrying it', async () => {
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('AI_MODEL', 'llama3.1');
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ error: { message: 'bad request', type: 'invalid_request_error' } }, 400)));
    const { default: OpenAI } = await import('./openai');

    await expect(OpenAI.processReceipt(['aGVsbG8='], 'image/png')).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
