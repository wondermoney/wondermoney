import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockReq, mockRes } from '@app/__tests__/__helpers__/mock-request';
import { buildInfo } from '@utils/constants';

import { getInstance } from '../instance';

const INTEGRATION_KEYS = ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_MODEL_STATEMENT_IMPORT', 'AI_PROVIDER', 'ANTHROPIC_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AZURE_AI_FOUNDRY_API_KEY', 'AZURE_AI_FOUNDRY_API_VERSION', 'AZURE_AI_FOUNDRY_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_API_VERSION', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_OCR_DEPLOYMENT', 'AZURE_OPENAI_STATEMENT_IMPORT_DEPLOYMENT', 'DEMO_SIGN_IN_ENABLED', 'EMAIL_DRIVER', 'EODHD_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'INSTANCE_NAME', 'MARKET_DATA_PROVIDERS', 'MIN_APP_VERSION', 'RESEND_API_KEY', 'SIGNUP_MODE', 'SMTP_HOST', 'SPONSOR_URL', 'STATEMENT_IMPORT_MAX_BYTES', 'STATEMENT_IMPORT_MAX_PAGES', 'SUPPORT_EMAIL'];

describe('GET /v1/instance', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const describeInstance = () => {
    const json = vi.fn();
    getInstance(mockReq(), mockRes({ json }));
    return json.mock.calls[0]?.[0] as Record<string, unknown>;
  };

  it('describes a bare install: open signup and every optional integration off', () => {
    for (const key of INTEGRATION_KEYS) vi.stubEnv(key, '');

    expect(describeInstance()).toEqual({
      apiVersion: 1,
      ...buildInfo(),
      features: {
        ai: { assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false, statementImport: false },
        bankSync: true,
        bankSyncProviders: ['enable_banking'],
        contactForm: false,
        demo: false,
        email: false,
        feedback: false,
        fileStorage: false,
        googleSignIn: false,
        marketData: false,
        marketDataCapabilities: [],
        marketDataProviders: [],
        mcp: true,
        oidc: null,
        passkey: true,
        passwordSignIn: true,
        statementImport: null,
      },
      minAppVersion: null,
      name: 'WonderMoney',
      signupMode: 'open',
      sponsorUrl: null,
      supportEmail: null,
    });
  });

  it('reports what the operator configured', () => {
    for (const key of INTEGRATION_KEYS) vi.stubEnv(key, '');
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('AI_MODEL', 'llama3.1');
    vi.stubEnv('EODHD_API_KEY', 'key');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('INSTANCE_NAME', 'Casa');
    vi.stubEnv('MIN_APP_VERSION', '2.1.0');
    vi.stubEnv('SIGNUP_MODE', 'invite');
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('SPONSOR_URL', 'https://opencollective.com/example');
    vi.stubEnv('SUPPORT_EMAIL', 'help@example.com');

    expect(describeInstance()).toMatchObject({
      features: { ai: { assistant: true, ocr: true }, contactForm: true, email: true, feedback: true, googleSignIn: true, marketData: true, marketDataCapabilities: ['search', 'quote', 'dailyHistory', 'dividends', 'splits'], marketDataProviders: ['eodhd'] },
      minAppVersion: '2.1.0',
      name: 'Casa',
      signupMode: 'invite',
      sponsorUrl: 'https://opencollective.com/example',
      supportEmail: 'help@example.com',
    });
  });

  it('reports market data from free providers an operator listed, and only what they can do', () => {
    for (const key of INTEGRATION_KEYS) vi.stubEnv(key, '');
    vi.stubEnv('MARKET_DATA_PROVIDERS', 'eodhd,stooq');

    expect(describeInstance()).toMatchObject({
      features: { marketData: true, marketDataCapabilities: ['quote', 'dailyHistory'], marketDataProviders: ['stooq'] },
    });
  });

  it('reports the one-click demo only when the operator turned it on', () => {
    for (const key of INTEGRATION_KEYS) vi.stubEnv(key, '');
    expect(describeInstance()).toMatchObject({ features: { demo: false } });

    vi.stubEnv('DEMO_SIGN_IN_ENABLED', 'false');
    expect(describeInstance()).toMatchObject({ features: { demo: false } });

    vi.stubEnv('DEMO_SIGN_IN_ENABLED', 'true');
    expect(describeInstance()).toMatchObject({ features: { demo: true } });
  });

  it('reports the AI features as enabled for an Anthropic setup', () => {
    for (const key of INTEGRATION_KEYS) vi.stubEnv(key, '');
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.stubEnv('AI_MODEL', 'claude-sonnet-4-5');

    expect(describeInstance()).toMatchObject({
      features: { ai: { assistant: true, csvMapping: true, enrichment: true, monthlyStory: true, ocr: true, statementImport: true } },
    });
  });

  it('names who reads PDF statements, and the largest one taken, once a model for it is set', () => {
    for (const key of INTEGRATION_KEYS) vi.stubEnv(key, '');
    vi.stubEnv('AI_BASE_URL', 'https://api.openai.com/v1');
    vi.stubEnv('AI_MODEL', 'gpt-4.1-mini');
    expect(describeInstance()).toMatchObject({ features: { ai: { statementImport: false }, statementImport: null } });

    vi.stubEnv('AI_MODEL_STATEMENT_IMPORT', 'gpt-4o');
    vi.stubEnv('STATEMENT_IMPORT_MAX_PAGES', '5');
    expect(describeInstance()).toMatchObject({
      features: { ai: { statementImport: true }, statementImport: { maxBytes: 10 * 1024 * 1024, maxPages: 5, providerKind: 'openai-compatible' } },
    });
  });

  it.each([
    ['an OpenAI-compatible endpoint on an internal host', { AI_API_KEY: 'sk-internal-secret', AI_BASE_URL: 'http://ollama.lan.internal:11434/v1', AI_MODEL: 'llama3.1', AI_MODEL_STATEMENT_IMPORT: 'qwen2.5vl' }, ['ollama.lan.internal', '11434', 'sk-internal-secret', 'qwen2.5vl', 'llama3.1']],
    ['Anthropic', { AI_MODEL: 'claude-sonnet-4-5', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-secret' }, ['anthropic.com', 'sk-ant-secret', 'claude-sonnet-4-5']],
    ['Azure', { AZURE_AI_FOUNDRY_API_KEY: 'foundry-secret', AZURE_AI_FOUNDRY_API_VERSION: '2024-05-01-preview', AZURE_AI_FOUNDRY_ENDPOINT: 'https://foundry-host.services.ai.azure.com', AZURE_OPENAI_API_KEY: 'azure-secret', AZURE_OPENAI_API_VERSION: '2024-08-01-preview', AZURE_OPENAI_DEPLOYMENT: 'assistant-deployment', AZURE_OPENAI_ENDPOINT: 'https://private-resource.openai.azure.com', AZURE_OPENAI_OCR_DEPLOYMENT: 'ocr-deployment', AZURE_OPENAI_STATEMENT_IMPORT_DEPLOYMENT: 'statements-deployment' }, ['private-resource', 'foundry-host', 'azure.com', 'azure-secret', 'foundry-secret', 'statements-deployment']],
  ])('never names the address, key or model of the AI provider (%s)', (_name, env, secrets) => {
    for (const key of INTEGRATION_KEYS) vi.stubEnv(key, '');
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const body = describeInstance();
    expect(body).toMatchObject({ features: { ai: { statementImport: true } } });
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/:\/\/|https?:/u);
    for (const secret of secrets) expect(text).not.toContain(secret);
  });

  it('reports the read-only MCP server, and hides it when MCP_ENABLED is false', () => {
    for (const key of INTEGRATION_KEYS) vi.stubEnv(key, '');
    vi.stubEnv('MCP_ENABLED', '');
    expect(describeInstance()).toMatchObject({ features: { mcp: true } });

    vi.stubEnv('MCP_ENABLED', 'false');
    expect(describeInstance()).toMatchObject({ features: { mcp: false } });
  });

  it('offers Google sign-in only when both of its credentials are set', () => {
    for (const key of INTEGRATION_KEYS) vi.stubEnv(key, '');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id');

    expect(describeInstance()).toMatchObject({ features: { googleSignIn: false } });
  });

  it('offers single sign-on by its display name once the OIDC provider is configured', () => {
    vi.stubEnv('OIDC_ISSUER', 'https://sso.example.com/realms/home');
    vi.stubEnv('OIDC_CLIENT_ID', 'wondermoney');
    vi.stubEnv('OIDC_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('OIDC_DISPLAY_NAME', 'Home SSO');

    expect(describeInstance()).toMatchObject({ features: { oidc: { name: 'Home SSO' }, passwordSignIn: true } });
    // The client secret and the issuer are the server's business.
    expect(JSON.stringify(describeInstance())).not.toContain('client-secret');
  });

  it('turns password sign-in off under OIDC_ONLY', () => {
    vi.stubEnv('OIDC_ISSUER', 'https://sso.example.com/realms/home');
    vi.stubEnv('OIDC_CLIENT_ID', 'wondermoney');
    vi.stubEnv('OIDC_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('OIDC_ONLY', 'true');

    expect(describeInstance()).toMatchObject({ features: { oidc: { name: 'SSO' }, passwordSignIn: false } });
  });

  it('offers feedback only when it can be emailed to a support inbox', () => {
    for (const key of INTEGRATION_KEYS) vi.stubEnv(key, '');
    vi.stubEnv('SUPPORT_EMAIL', 'help@example.com');
    expect(describeInstance()).toMatchObject({ features: { contactForm: true, feedback: false } });

    vi.stubEnv('SUPPORT_EMAIL', '');
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    expect(describeInstance()).toMatchObject({ features: { feedback: false } });

    vi.stubEnv('SUPPORT_EMAIL', 'help@example.com');
    expect(describeInstance()).toMatchObject({ features: { feedback: true } });
  });
});
