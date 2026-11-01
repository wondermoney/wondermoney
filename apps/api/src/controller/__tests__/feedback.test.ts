import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockReq, mockRes } from '@app/__tests__/__helpers__/mock-request';

const mocked = vi.hoisted(() => ({ sendFeedbackEmail: vi.fn() }));

vi.mock('@service/email/email', () => ({ sendFeedbackEmail: mocked.sendFeedbackEmail }));

import { submitFeedback } from '../feedback';

const request = (body: Record<string, unknown> = { message: 'The chart is wrong', page: '/budgets', type: 'bug' }) => {
  const req = mockReq({ body });
  req.user = { appuserKey: 7, emailAddress: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' } as Request['user'];
  return req;
};

describe('POST /v1/feedback', () => {
  beforeEach(() => {
    mocked.sendFeedbackEmail.mockReset().mockResolvedValue({ providerMessageIds: ['id'], type: 'accepted' });
    vi.stubEnv('EMAIL_DRIVER', '');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('SUPPORT_EMAIL', 'help@example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('emails the feedback, from the signed-in user, and answers 204 once it is accepted', async () => {
    const sendStatus = vi.fn();

    await submitFeedback(request(), mockRes({ sendStatus }));

    expect(mocked.sendFeedbackEmail).toHaveBeenCalledWith({ email: 'ada@example.com', message: 'The chart is wrong', name: 'Ada Lovelace', page: '/budgets', type: 'bug' });
    expect(sendStatus).toHaveBeenCalledWith(204);
  });

  it.each([
    ['rejected by the provider', { retryable: false, type: 'rejected' }],
    ['of unknown fate', { type: 'unknown' }],
    ['intercepted', { type: 'intercepted' }],
  ])('fails, instead of answering success, when the email is %s', async (_label, outcome) => {
    mocked.sendFeedbackEmail.mockResolvedValue(outcome);
    const sendStatus = vi.fn();

    await expect(submitFeedback(request(), mockRes({ sendStatus }))).rejects.toMatchObject({ status: 502 });
    expect(sendStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['there is no support inbox', { SUPPORT_EMAIL: '' }],
    ['mail only goes to the log', { EMAIL_DRIVER: 'log' }],
  ])('is disabled, and sends nothing, when %s', async (_label, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

    await expect(submitFeedback(request(), mockRes())).rejects.toMatchObject({ code: 'feature_disabled' });
    expect(mocked.sendFeedbackEmail).not.toHaveBeenCalled();
  });

  it('rejects an empty message', async () => {
    await expect(submitFeedback(request({ message: '   ', type: 'bug' }), mockRes())).rejects.toMatchObject({ status: 400 });
    expect(mocked.sendFeedbackEmail).not.toHaveBeenCalled();
  });
});
