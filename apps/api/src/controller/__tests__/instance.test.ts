import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockReq, mockRes } from '@app/__tests__/__helpers__/mock-request';

import { getInstance } from '../instance';

const INTEGRATION_KEYS = ['AI_BASE_URL', 'AI_MODEL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AZURE_AI_FOUNDRY_API_KEY', 'AZURE_OPENAI_API_KEY', 'EODHD_API_KEY', 'INSTANCE_NAME', 'MIN_APP_VERSION', 'RESEND_API_KEY', 'SIGNUP_MODE', 'SMTP_HOST', 'SUPPORT_EMAIL'];

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
      features: {
        ai: { assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false },
        bankSync: true,
        contactForm: false,
        email: false,
        fileStorage: false,
        marketData: false,
      },
      minAppVersion: null,
      name: 'WonderMoney',
      signupMode: 'open',
    });
  });

  it('reports what the operator configured', () => {
    for (const key of INTEGRATION_KEYS) vi.stubEnv(key, '');
    vi.stubEnv('AI_BASE_URL', 'http://localhost:11434/v1');
    vi.stubEnv('AI_MODEL', 'llama3.1');
    vi.stubEnv('EODHD_API_KEY', 'key');
    vi.stubEnv('INSTANCE_NAME', 'Casa');
    vi.stubEnv('MIN_APP_VERSION', '2.1.0');
    vi.stubEnv('SIGNUP_MODE', 'invite');
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('SUPPORT_EMAIL', 'help@example.com');

    expect(describeInstance()).toMatchObject({
      features: { ai: { assistant: true, ocr: true }, contactForm: true, email: true, marketData: true },
      minAppVersion: '2.1.0',
      name: 'Casa',
      signupMode: 'invite',
    });
  });
});
