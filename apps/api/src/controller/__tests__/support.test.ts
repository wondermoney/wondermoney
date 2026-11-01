import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockReq, mockRes } from '@app/__tests__/__helpers__/mock-request';

const mocked = vi.hoisted(() => ({ fetch: vi.fn(), sendSupportEmail: vi.fn() }));

vi.mock('@service/email/email', () => ({ sendSupportEmail: mocked.sendSupportEmail }));

import { processSupportEmail } from '../support';

const request = (captcha?: string) => mockReq({ body: { captcha, email: 'person@example.com', message: 'Help', name: 'Person' } });

describe('processSupportEmail', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mocked.fetch);
    mocked.fetch.mockReset();
    mocked.sendSupportEmail.mockReset().mockResolvedValue({ providerMessageIds: ['id'], type: 'accepted' });
    vi.stubEnv('SUPPORT_EMAIL', 'help@example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('verifies the captcha when a reCAPTCHA secret is configured', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', 'secret');
    mocked.fetch.mockResolvedValue({ json: () => Promise.resolve({ success: false }) });
    const sendStatus = vi.fn();

    await processSupportEmail(request('token'), mockRes({ sendStatus }));

    expect(sendStatus).toHaveBeenCalledWith(400);
    expect(mocked.sendSupportEmail).not.toHaveBeenCalled();
  });

  it('rejects a missing captcha when a reCAPTCHA secret is configured', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', 'secret');
    const sendStatus = vi.fn();

    await processSupportEmail(request(undefined), mockRes({ sendStatus }));

    expect(sendStatus).toHaveBeenCalledWith(400);
    expect(mocked.fetch).not.toHaveBeenCalled();
  });

  it('delivers without a captcha when no reCAPTCHA secret is configured', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', '');
    const sendStatus = vi.fn();

    await processSupportEmail(request(undefined), mockRes({ sendStatus }));

    expect(mocked.fetch).not.toHaveBeenCalled();
    expect(mocked.sendSupportEmail).toHaveBeenCalled();
    expect(sendStatus).toHaveBeenCalledWith(200);
  });

  it.each([
    ['rejected by the provider', { retryable: false, type: 'rejected' }],
    ['of unknown fate', { type: 'unknown' }],
    ['intercepted', { type: 'intercepted' }],
  ])('fails with 502, instead of answering success, when the email is %s', async (_label, outcome) => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', '');
    mocked.sendSupportEmail.mockResolvedValue(outcome);
    const sendStatus = vi.fn();

    await expect(processSupportEmail(request(undefined), mockRes({ sendStatus }))).rejects.toMatchObject({ status: 502 });
    expect(sendStatus).not.toHaveBeenCalled();
  });

  it('reports the form as disabled when there is no team inbox to deliver to', async () => {
    vi.stubEnv('SUPPORT_EMAIL', '');

    await expect(processSupportEmail(request('token'), mockRes())).rejects.toMatchObject({ code: 'feature_disabled' });
    expect(mocked.sendSupportEmail).not.toHaveBeenCalled();
  });
});
