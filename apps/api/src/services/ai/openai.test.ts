import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  azureConstructor: vi.fn(),
  create: vi.fn(),
  openAiConstructor: vi.fn(),
}));

vi.mock('openai', () => ({
  AzureOpenAI: class {
    chat = { completions: { create: mocked.create } };

    constructor(config: unknown) {
      mocked.azureConstructor(config);
    }
  },
  OpenAI: class {
    chat = { completions: { create: mocked.create } };

    constructor(config: unknown) {
      mocked.openAiConstructor(config);
    }
  },
}));

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

const textPrompt = {
  feature: 'csvMapping' as const,
  messages: [{ content: 'hello', role: 'user' as const }],
  model: 'gpt-5.4-nano',
  responseFormat: { type: 'json_object' as const },
};

describe('openai service', () => {
  beforeEach(() => {
    vi.resetModules();
    mocked.azureConstructor.mockReset();
    mocked.openAiConstructor.mockReset();
    mocked.create.mockReset();
    mocked.create.mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { completion_tokens: 7, prompt_tokens: 11, total_tokens: 18 },
    });
    for (const key of AI_ENV_KEYS) vi.stubEnv(key, undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not throw when imported without any AI configured', async () => {
    await expect(import('./openai')).resolves.toBeDefined();
  });

  it('reports the feature as disabled, without building a client, when nothing is configured', async () => {
    const { default: OpenAI } = await import('./openai');

    await expect(OpenAI.processReceipt(['abc'], 'image/png')).rejects.toMatchObject({ code: 'feature_disabled', status: 501 });
    await expect(OpenAI.promptWithText(textPrompt)).rejects.toMatchObject({ code: 'feature_disabled' });
    expect(mocked.azureConstructor).not.toHaveBeenCalled();
    expect(mocked.openAiConstructor).not.toHaveBeenCalled();
  });

  it('calls the Azure deployment the caller names, and reuses the client', async () => {
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'key');
    vi.stubEnv('AZURE_OPENAI_API_VERSION', '2024-08-01-preview');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://example.openai.azure.com');
    const { default: OpenAI } = await import('./openai');

    await expect(OpenAI.promptWithText({ ...textPrompt, temperature: 0 })).resolves.toEqual({
      answer: '{"ok":true}',
      completionTokens: 7,
      promptTokens: 11,
      tokens: 18,
    });
    await OpenAI.promptWithText(textPrompt);

    expect(mocked.azureConstructor).toHaveBeenCalledTimes(1);
    expect(mocked.create).toHaveBeenNthCalledWith(1, {
      messages: textPrompt.messages,
      model: 'gpt-5.4-nano',
      response_format: { type: 'json_object' },
      temperature: 0,
    });
  });

  it('uses the configured model on an OpenAI-compatible endpoint, not the Azure deployment name', async () => {
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('AI_MODEL', 'llama3.1');
    vi.stubEnv('AI_MODEL_CSV_MAPPING', 'qwen2.5');
    const { default: OpenAI } = await import('./openai');

    await OpenAI.promptWithText(textPrompt);
    await OpenAI.processReceipt(['abc'], 'image/png');

    expect(mocked.openAiConstructor).toHaveBeenCalledTimes(1);
    expect(mocked.openAiConstructor).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'not-needed', baseURL: 'http://localhost:11434/v1' }));
    expect(mocked.create.mock.calls.map(([request]) => (request as { model: string }).model)).toEqual(['qwen2.5', 'llama3.1']);
  });
});
