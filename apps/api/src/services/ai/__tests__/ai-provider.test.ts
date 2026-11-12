import { describe, expect, it } from 'vitest';

import { aiCapabilities, aiProviderLabel, resolveAiRoute } from '../ai-provider';

const AZURE_OPENAI = {
  AZURE_OPENAI_API_KEY: 'azure-key',
  AZURE_OPENAI_API_VERSION: '2024-08-01-preview',
  AZURE_OPENAI_DEPLOYMENT: 'assistant-deployment',
  AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
  AZURE_OPENAI_OCR_DEPLOYMENT: 'ocr-deployment',
};
const AZURE_FOUNDRY = {
  AZURE_AI_FOUNDRY_API_KEY: 'foundry-key',
  AZURE_AI_FOUNDRY_API_VERSION: '2024-05-01-preview',
  AZURE_AI_FOUNDRY_ENDPOINT: 'https://example.services.ai.azure.com',
};

describe('resolveAiRoute', () => {
  it('disables every feature when nothing is configured', () => {
    expect(aiCapabilities({})).toEqual({ assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false, statementImport: false });
    expect(resolveAiRoute('ocr', {})).toEqual({ kind: 'disabled' });
  });

  it('keeps the hosted Azure setup: Azure OpenAI for chat features, Foundry for enrichment', () => {
    const env = { ...AZURE_OPENAI, ...AZURE_FOUNDRY };
    expect(resolveAiRoute('ocr', env)).toMatchObject({ kind: 'azure-openai', model: 'ocr-deployment' });
    expect(resolveAiRoute('assistant', env)).toMatchObject({ kind: 'azure-openai', model: 'assistant-deployment' });
    expect(resolveAiRoute('enrichment', env)).toMatchObject({ kind: 'azure-foundry' });
  });

  it('prefers Azure over an OpenAI-compatible endpoint when both are set', () => {
    const env = { ...AZURE_OPENAI, AI_BASE_URL: 'http://localhost:11434/v1', AI_MODEL: 'llama3.1' };
    expect(resolveAiRoute('csvMapping', env).kind).toBe('azure-openai');
  });

  it('routes every feature to an OpenAI-compatible endpoint with one default model', () => {
    const env = { AI_BASE_URL: 'http://localhost:11434/v1/', AI_MODEL: 'llama3.1' };
    expect(resolveAiRoute('enrichment', env)).toEqual({ apiKey: null, baseURL: 'http://localhost:11434/v1', kind: 'openai-compatible', model: 'llama3.1' });
    // Statement import sends page images: the default model is not trusted to read them.
    expect(aiCapabilities(env)).toEqual({ assistant: true, csvMapping: true, enrichment: true, monthlyStory: true, ocr: true, statementImport: false });
  });

  it('lets a per-feature model override the default, and leaves a feature off without any model', () => {
    const env = { AI_API_KEY: 'sk-test', AI_BASE_URL: 'https://api.openai.com/v1', AI_MODEL_OCR: 'gpt-4o-mini' };
    expect(resolveAiRoute('ocr', env)).toEqual({ apiKey: 'sk-test', baseURL: 'https://api.openai.com/v1', kind: 'openai-compatible', model: 'gpt-4o-mini' });
    expect(resolveAiRoute('assistant', env)).toEqual({ kind: 'disabled' });
  });

  it('treats a half-configured Azure resource as absent rather than failing at call time', () => {
    const env = { AZURE_OPENAI_API_KEY: 'azure-key', AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com' };
    expect(resolveAiRoute('csvMapping', env)).toEqual({ kind: 'disabled' });
  });

  it('routes every feature to Anthropic when AI_PROVIDER names it and a key is set', () => {
    const env = { AI_MODEL: 'claude-sonnet-4-5', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' };
    expect(resolveAiRoute('assistant', env)).toEqual({ apiKey: 'sk-ant-test', kind: 'anthropic', model: 'claude-sonnet-4-5' });
    expect(aiCapabilities(env)).toEqual({ assistant: true, csvMapping: true, enrichment: true, monthlyStory: true, ocr: true, statementImport: true });
  });

  it('lets a per-feature model override the Anthropic default', () => {
    const env = { AI_MODEL: 'claude-sonnet-4-5', AI_MODEL_OCR: 'claude-haiku-4-5', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' };
    expect(resolveAiRoute('ocr', env)).toEqual({ apiKey: 'sk-ant-test', kind: 'anthropic', model: 'claude-haiku-4-5' });
    expect(resolveAiRoute('assistant', env)).toMatchObject({ model: 'claude-sonnet-4-5' });
  });

  it('leaves Anthropic off without a key or a model, rather than guessing one', () => {
    expect(resolveAiRoute('assistant', { AI_MODEL: 'claude-sonnet-4-5', AI_PROVIDER: 'anthropic' })).toEqual({ kind: 'disabled' });
    expect(resolveAiRoute('assistant', { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' })).toEqual({ kind: 'disabled' });
    // The key alone does not opt in; AI_PROVIDER is the switch.
    expect(resolveAiRoute('assistant', { AI_MODEL: 'claude-sonnet-4-5', ANTHROPIC_API_KEY: 'sk-ant-test' })).toEqual({ kind: 'disabled' });
  });

  it('keeps Azure ahead of Anthropic, and Anthropic ahead of an OpenAI-compatible endpoint', () => {
    const anthropic = { AI_MODEL: 'claude-sonnet-4-5', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' };
    expect(resolveAiRoute('assistant', { ...AZURE_OPENAI, ...anthropic }).kind).toBe('azure-openai');
    expect(resolveAiRoute('assistant', { ...anthropic, AI_BASE_URL: 'http://localhost:11434/v1' }).kind).toBe('anthropic');
  });
});

describe('statement import routing', () => {
  it('needs a model named for it on an OpenAI-compatible endpoint, which may be text-only by default', () => {
    const base = { AI_BASE_URL: 'https://api.openai.com/v1', AI_MODEL: 'gpt-4.1-mini' };
    expect(resolveAiRoute('statementImport', base)).toEqual({ kind: 'disabled' });
    // Receipt scanning's vision model is not borrowed either: the operator opts this feature in.
    expect(resolveAiRoute('statementImport', { ...base, AI_MODEL_OCR: 'gpt-4o' })).toEqual({ kind: 'disabled' });
    expect(resolveAiRoute('statementImport', { ...base, AI_MODEL_STATEMENT_IMPORT: 'gpt-4o' })).toMatchObject({ kind: 'openai-compatible', model: 'gpt-4o' });
  });

  it('takes the default Anthropic model, which reads images, but refuses a text-only Claude', () => {
    const anthropic = { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' };
    expect(resolveAiRoute('statementImport', { ...anthropic, AI_MODEL: 'claude-sonnet-4-5' })).toMatchObject({ kind: 'anthropic', model: 'claude-sonnet-4-5' });
    expect(resolveAiRoute('statementImport', { ...anthropic, AI_MODEL: 'claude-2.1' })).toEqual({ kind: 'disabled' });
    expect(resolveAiRoute('statementImport', { ...anthropic, AI_MODEL: 'claude-instant-1.2' })).toEqual({ kind: 'disabled' });
    expect(resolveAiRoute('ocr', { ...anthropic, AI_MODEL: 'claude-2.1' })).toEqual({ kind: 'disabled' });
    // A text-only model still serves the text features.
    expect(resolveAiRoute('csvMapping', { ...anthropic, AI_MODEL: 'claude-2.1' })).toMatchObject({ kind: 'anthropic' });
  });

  it('uses its own Azure deployment, and falls through to the next provider without one', () => {
    expect(resolveAiRoute('statementImport', AZURE_OPENAI)).toEqual({ kind: 'disabled' });
    expect(resolveAiRoute('statementImport', { ...AZURE_OPENAI, AZURE_OPENAI_STATEMENT_IMPORT_DEPLOYMENT: 'statements' })).toMatchObject({ kind: 'azure-openai', model: 'statements' });
  });

  it('names the provider the pages go to, for the consent line', () => {
    expect(aiProviderLabel('statementImport', {})).toBeNull();
    expect(aiProviderLabel('statementImport', { AI_MODEL: 'claude-sonnet-4-5', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' })).toEqual({ kind: 'anthropic', name: 'Anthropic' });
    expect(aiProviderLabel('statementImport', { ...AZURE_OPENAI, AZURE_OPENAI_STATEMENT_IMPORT_DEPLOYMENT: 'statements' })).toEqual({ kind: 'azure-openai', name: 'Azure OpenAI' });
    // An OpenAI-compatible endpoint is often an internal host: its address is never a label.
    expect(aiProviderLabel('statementImport', { AI_BASE_URL: 'http://ollama.internal.example:11434/v1', AI_MODEL_STATEMENT_IMPORT: 'qwen2.5vl' })).toEqual({ kind: 'openai-compatible', name: null });
  });
});
