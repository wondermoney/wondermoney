import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BankRecoveryEmailInput } from '../email';

const { loggerInfo, resendCtor, resendSendMock } = vi.hoisted(() => {
  const resendSend = vi.fn();
  return {
    loggerInfo: vi.fn(),
    resendCtor: vi.fn(function () { return { emails: { send: resendSend } }; }),
    resendSendMock: resendSend,
  };
});

vi.mock('@utils/logger', () => ({
  default: { error: vi.fn(), info: loggerInfo, warn: vi.fn() },
}));

vi.mock('resend', () => ({ Resend: resendCtor }));

const loadModule = async (nodeEnv: string) => {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('RESEND_API_KEY', 'resend-key');
  vi.stubEnv('RESEND_FROM_EMAIL', 'hello@wonder.money');
  vi.stubEnv('RESEND_FROM_NAME', 'Wonder.money');
  vi.stubEnv('EMAIL_OPT_OUT_SIGNING_SECRET', 'test-opt-out-secret-that-is-long-enough-000');
  vi.stubEnv('SUPPORT_EMAIL', 'support@wonder.money');
  return import('../email');
};

describe('internal admin emails', () => {
  beforeEach(() => {
    resendCtor.mockClear();
    resendSendMock.mockReset();
    loggerInfo.mockReset();
    vi.unstubAllEnvs();
  });

  it('renders the admin account deleted email as branded HTML to support@ with the detail rows', async () => {
    resendSendMock.mockResolvedValue({ data: { id: 'resend-id' }, error: null });
    const { sendAccountDeletedEmail } = await loadModule('production');

    await sendAccountDeletedEmail({
      appuserKey: 123,
      deletedAt: new Date('2026-07-07T12:00:00.000Z'),
      userEmail: 'user@example.com',
    });

    const payload = resendSendMock.mock.calls[0]?.[0];
    expect(payload.to).toBe('support@wonder.money');
    expect(payload.subject).toBe('Wonder.money - Account deleted');
    expect(payload.html).toContain('Account deleted');
    expect(payload.html).toContain('user@example.com');
    expect(payload.html).toContain('123');
    expect(payload.html).toContain('2026-07-07T12:00:00.000Z');
    expect(payload).not.toHaveProperty('attachments');
  });
});

describe('rendered Resend boundary', () => {
  beforeEach(() => {
    resendCtor.mockClear();
    resendSendMock.mockReset();
    loggerInfo.mockReset();
    vi.unstubAllEnvs();
  });

  it('sends HTML/text/headers via Resend and captures the message id', async () => {
    resendSendMock.mockResolvedValue({ data: { id: 'resend-id-1' }, error: null });
    const { sendRenderedEmail } = await loadModule('production');
    const outcome = await sendRenderedEmail({
      headers: { 'List-Unsubscribe': '<https://api.example/unsubscribe?token=redacted>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      html: '<p>financial</p>',
      subject: 'Resumo',
      text: 'financial',
      to: { email: 'user@example.com', name: 'User' },
    });
    const payload = resendSendMock.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      from: 'Wonder.money <hello@wonder.money>',
      headers: { 'List-Unsubscribe': '<https://api.example/unsubscribe?token=redacted>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      html: '<p>financial</p>',
      subject: 'Resumo',
      text: 'financial',
      to: 'User <user@example.com>',
    });
    expect(payload).not.toHaveProperty('template');
    expect(payload).not.toHaveProperty('replyTo');
    expect(outcome).toEqual({ providerMessageIds: ['resend-id-1'], type: 'accepted' });
  });

  it('includes a replyTo address when provided', async () => {
    resendSendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
    const { sendRenderedEmail } = await loadModule('production');
    await sendRenderedEmail({ headers: { test: 'set' }, html: 'h', replyTo: { email: 'support@wonder.money' }, subject: 's', text: 't', to: { email: 'u@example.com' } });
    expect(resendSendMock.mock.calls[0]?.[0].replyTo).toBe('support@wonder.money');
  });

  it('defaults the sender to RESEND_FROM_EMAIL', async () => {
    resendSendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
    const { sendRenderedEmail } = await loadModule('production');
    await sendRenderedEmail({ headers: {}, html: 'h', subject: 's', text: 't', to: { email: 'u@example.com' } });
    expect(resendSendMock.mock.calls[0]?.[0].from).not.toContain('someone@example.com');
  });

  it('overrides the sender when a personal from is supplied', async () => {
    // RAD-583: the founder outreach must arrive from a person. Defaulting it to
    // the product's `hello@` sender would make a reply-seeking personal note
    // read as marketing.
    resendSendMock.mockResolvedValue({ data: { id: 'x' }, error: null });
    const { sendRenderedEmail } = await loadModule('production');
    await sendRenderedEmail({ from: { email: 'someone@example.com', name: 'Someone' }, headers: {}, html: 'h', subject: 's', text: 't', to: { email: 'u@example.com' } });
    expect(resendSendMock.mock.calls[0]?.[0].from).toBe('Someone <someone@example.com>');
  });

  it.each([
    [{ data: null, error: { message: 'x', name: 'rate_limit_exceeded', statusCode: 429 } }, { errorCode: 'rate_limit_exceeded', retryable: true, type: 'rejected' }],
    [{ data: null, error: { message: 'x', name: 'internal_server_error', statusCode: 500 } }, { errorCode: 'internal_server_error', retryable: true, type: 'rejected' }],
    [{ data: null, error: { message: 'x', name: 'validation_error', statusCode: 422 } }, { errorCode: 'validation_error', retryable: false, type: 'rejected' }],
    [{ data: null, error: { message: 'x', name: 'invalid_from_address', statusCode: 403 } }, { errorCode: 'invalid_from_address', retryable: false, type: 'rejected' }],
    [{ data: null, error: { message: 'Unable to fetch data.', name: 'application_error', statusCode: null } }, { type: 'unknown' }],
  ])('classifies Resend error responses', async (response, expected) => {
    resendSendMock.mockResolvedValue(response);
    const { sendRenderedEmail } = await loadModule('production');
    await expect(sendRenderedEmail({ headers: { test: 'set' }, html: 'h', subject: 's', text: 't', to: { email: 'u@example.com' } })).resolves.toEqual(expected);
  });

  it('treats a success response without an id as unknown', async () => {
    resendSendMock.mockResolvedValue({ data: null, error: null });
    const { sendRenderedEmail } = await loadModule('production');
    await expect(sendRenderedEmail({ headers: { test: 'set' }, html: 'h', subject: 's', text: 't', to: { email: 'u@example.com' } })).resolves.toEqual({ type: 'unknown' });
  });

  it('intercepts before making a Resend request', async () => {
    const { sendRenderedEmail } = await loadModule('test');
    await expect(sendRenderedEmail({ headers: { test: 'set' }, html: 'h', subject: 's', text: 't', to: { email: 'u@example.com' } })).resolves.toEqual({ type: 'intercepted' });
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});

describe('legacy sendEmail via Resend', () => {
  beforeEach(() => {
    resendCtor.mockClear();
    resendSendMock.mockReset();
    resendSendMock.mockResolvedValue({ data: { id: 'resend-id' }, error: null });
    loggerInfo.mockReset();
    vi.unstubAllEnvs();
  });

  it('renders the support request as branded HTML through Resend to support@', async () => {
    const { sendSupportEmail } = await loadModule('production');
    await sendSupportEmail({ email: 'user@example.com', message: 'Please help me', name: 'Ada' });
    const payload = resendSendMock.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      from: 'Wonder.money <hello@wonder.money>',
      subject: 'Wonder.money - Support',
      to: 'support@wonder.money',
    });
    expect(payload.html).toContain('Support request');
    expect(payload.html).toContain('Please help me');
    expect(payload.html).toContain('Ada');
    expect(payload.html).toContain('user@example.com');
    expect(payload).not.toHaveProperty('attachments');
    expect(payload).not.toHaveProperty('template');
  });

});

describe('bank recovery email provider seam', () => {
  const input = {
    incidentId: 'incident-123',
    language: 'EN' as const,
    recipient: 'private@example.com',
    recoveryUrl: 'https://app.wonder.money/accounts',
    templateVersion: 'bank-recovery-v1',
    unsubscribeUrl: 'https://api.wonder.money/v1/marketing/email-opt-out?token=abc',
  };

  const ACCEPTED_ID = '11111111-2222-4333-8444-555555555555';

  beforeEach(() => {
    resendCtor.mockClear();
    resendSendMock.mockReset();
    resendSendMock.mockResolvedValue({ data: { id: ACCEPTED_ID }, error: null });
    loggerInfo.mockReset();
    vi.unstubAllEnvs();
  });

  it('does not construct a Resend client at import time', async () => {
    vi.resetModules();
    await expect(import('../email')).resolves.toBeDefined();
    expect(resendCtor).not.toHaveBeenCalled();
  });

  it.each([
    { heading: 'finish connecting your bank', language: 'EN' as const, subject: 'Your bank connection needs another try' },
    { heading: 'Vamos concluir a liga', language: 'PT' as const, subject: 'A sua ligação bancária precisa de nova tentativa' },
  ])('renders the $language bank-recovery nudge as branded HTML with a List-Unsubscribe header + idempotency key', async ({ heading, language, subject }) => {
    resendSendMock.mockResolvedValue({ data: { id: ACCEPTED_ID }, error: null });
    const { sendBankRecoveryEmail } = await loadModule('staging');

    await sendBankRecoveryEmail({ ...input, language });

    expect(resendSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Wonder.money <hello@wonder.money>',
        headers: { 'List-Unsubscribe': '<https://api.wonder.money/v1/marketing/email-opt-out?token=abc>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        subject,
        to: 'private@example.com',
      }),
      { idempotencyKey: 'incident-123:bank-recovery-v1' },
    );
    const payload = resendSendMock.mock.calls[0]?.[0];
    expect(payload.html).toContain(heading);
    expect(payload.html).toContain('https://app.wonder.money/accounts');
    expect(payload).not.toHaveProperty('replyTo');
  });

  it('renders the real bank name in the step visual when known', async () => {
    const { sendBankRecoveryEmail } = await loadModule('staging');
    await sendBankRecoveryEmail({ ...input, bankName: 'Banco Exemplo' });
    const payload = resendSendMock.mock.calls[0]?.[0];
    expect(payload.html).toContain('Banco Exemplo');
  });

  it('falls back to generic step copy when the bank name is unknown', async () => {
    const { sendBankRecoveryEmail } = await loadModule('staging');
    await sendBankRecoveryEmail(input);
    const payload = resendSendMock.mock.calls[0]?.[0];
    expect(payload.html).toContain('reach linked status');
  });

  it.each([
    [{ ...input, language: 'ES' }, 'invalid_language'],
    [{ ...input, recoveryUrl: 'http://app.wonder.money/accounts' }, 'invalid_recovery_url'],
    [{ ...input, recoveryUrl: 'https://user:secret@app.wonder.money/accounts' }, 'invalid_recovery_url'],
  ])('rejects invalid input before creating a client', async (invalidInput, code) => {
    const { sendBankRecoveryEmail } = await loadModule('staging');
    await expect(sendBankRecoveryEmail(invalidInput as unknown as BankRecoveryEmailInput)).resolves.toEqual({ code, status: 'pre_acceptance_permanent' });
    expect(resendCtor).not.toHaveBeenCalled();
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it('returns a single provider message id on success', async () => {
    const { sendBankRecoveryEmail } = await loadModule('staging');
    await expect(sendBankRecoveryEmail(input)).resolves.toEqual({ messageId: ACCEPTED_ID });
  });

  it('returns provider_timeout when the signal is already aborted', async () => {
    const { sendBankRecoveryEmail } = await loadModule('staging');
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn();
    await expect(sendBankRecoveryEmail({ ...input, signal: controller.signal }, { send })).resolves.toEqual({ code: 'provider_timeout', status: 'ambiguous' });
    expect(send).not.toHaveBeenCalled();
  });

  it('classifies a missing Resend API key as a retryable local setup failure', async () => {
    const { sendBankRecoveryEmail } = await loadModule('staging');
    vi.stubEnv('EMAIL_DRIVER', 'resend');
    vi.stubEnv('RESEND_API_KEY', '');
    await expect(sendBankRecoveryEmail(input)).resolves.toEqual({ code: 'local_provider_setup_failed', status: 'pre_acceptance_retryable' });
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 422] as const)('classifies documented %i rejection as pre-acceptance permanent', async (statusCode) => {
    const { sendBankRecoveryEmail } = await loadModule('staging');
    const send = vi.fn().mockResolvedValue({ data: null, error: { message: 'raw secret body', name: 'validation_error', statusCode } });
    await expect(sendBankRecoveryEmail(input, { send })).resolves.toEqual({ code: `provider_rejected_${statusCode}`, status: 'pre_acceptance_permanent' });
  });

  it('classifies an explicit provider 429 as retryable without leaking provider details', async () => {
    const { sendBankRecoveryEmail } = await loadModule('staging');
    const send = vi.fn().mockResolvedValue({ data: null, error: { message: `secret for ${input.recipient}`, name: 'rate_limit_exceeded', statusCode: 429 } });
    const outcome = await sendBankRecoveryEmail(input, { send });
    expect(outcome).toEqual({ code: 'provider_rate_limited', status: 'pre_acceptance_retryable' });
    expect(JSON.stringify(outcome)).not.toContain(input.recipient);
    expect(JSON.stringify(outcome)).not.toContain('secret');
  });

  it.each([
    [{ data: null, error: { message: 'x', name: 'internal_server_error', statusCode: 500 } }, { code: 'provider_5xx', status: 'ambiguous' }],
    [{ data: null, error: { message: 'Unable to fetch data.', name: 'application_error', statusCode: null } }, { code: 'provider_network_error', status: 'ambiguous' }],
  ])('classifies server and unresolved-network errors as ambiguous', async (result, expected) => {
    const { sendBankRecoveryEmail } = await loadModule('staging');
    const send = vi.fn().mockResolvedValue(result);
    await expect(sendBankRecoveryEmail(input, { send })).resolves.toEqual(expected);
  });

  it('classifies a thrown send as ambiguous provider_unknown without leaking the error', async () => {
    const { sendBankRecoveryEmail } = await loadModule('staging');
    const send = vi.fn().mockRejectedValue(new Error('private boom detail'));
    const outcome = await sendBankRecoveryEmail(input, { send });
    expect(outcome).toEqual({ code: 'provider_unknown', status: 'ambiguous' });
    expect(JSON.stringify(outcome)).not.toContain('private');
    expect(loggerInfo).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: null },
    { data: { id: 'not-a-uuid' }, error: null },
  ])('treats a malformed provider success as ambiguous', async (result) => {
    const { sendBankRecoveryEmail } = await loadModule('staging');
    const send = vi.fn().mockResolvedValue(result);
    await expect(sendBankRecoveryEmail(input, { send })).resolves.toEqual({ code: 'provider_malformed_response', status: 'ambiguous' });
  });
});

describe('transactional user emails (welcome)', () => {
  const user = { appuserKey: 42, emailAddress: 'user@example.com', firstName: 'Ada', language: 'EN' as const };

  beforeEach(() => {
    resendCtor.mockClear();
    resendSendMock.mockReset();
    resendSendMock.mockResolvedValue({ data: { id: 'resend-id' }, error: null });
    loggerInfo.mockReset();
    vi.unstubAllEnvs();
  });

  it('renders the welcome email as branded HTML to the user with an app-home CTA and opt-out footer', async () => {
    const { sendWelcomeEmail } = await loadModule('production');
    await sendWelcomeEmail(user);
    const payload = resendSendMock.mock.calls[0]?.[0];
    expect(payload.to).toBe('Ada <user@example.com>');
    expect(payload.subject).toContain('Welcome to WonderMoney');
    expect(payload.html).toContain('Welcome to WonderMoney');
    expect(payload.html).toContain('https://app.example.test/en');
    // Transactional footer carries a real account-wide opt-out as a one-click List-Unsubscribe.
    expect(payload.headers['List-Unsubscribe']).toMatch(/^<https:\/\/api\.example\.test\/v1\/marketing\/email-opt-out\?token=.+>$/u);
    expect(payload.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('renders the welcome email in Portuguese when the user language is PT', async () => {
    const { sendWelcomeEmail } = await loadModule('production');
    await sendWelcomeEmail({ ...user, language: 'PT' });
    const payload = resendSendMock.mock.calls[0]?.[0];
    expect(payload.subject).toContain('Bem-vindo à WonderMoney');
    expect(payload.html).toContain('Bem-vindo à WonderMoney');
    expect(payload.html).toContain('https://app.example.test/pt');
  });

  it('omits the recipient name when the user has no first name', async () => {
    const { sendWelcomeEmail } = await loadModule('production');
    await sendWelcomeEmail({ ...user, firstName: undefined });
    expect(resendSendMock.mock.calls[0]?.[0].to).toBe('user@example.com');
  });
});

describe('without an email provider or a team inbox', () => {
  const loadSelfHosted = async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('SUPPORT_EMAIL', '');
    vi.stubEnv('EMAIL_OPT_OUT_SIGNING_SECRET', 'test-opt-out-secret-that-is-long-enough-000');
    return import('../email');
  };

  beforeEach(() => {
    resendCtor.mockClear();
    resendSendMock.mockReset();
    loggerInfo.mockReset();
  });

  it('logs a user email, link included, instead of calling a provider', async () => {
    const { sendRenderedEmail } = await loadSelfHosted();

    const outcome = await sendRenderedEmail({ headers: {}, html: '<p>x</p>', subject: 'Reset', text: 'Reset: https://app.example.com/reset?t=1', to: { email: 'person@example.com' } });

    expect(outcome.type).toBe('accepted');
    expect(resendCtor).not.toHaveBeenCalled();
    expect(JSON.stringify(loggerInfo.mock.calls)).toContain('https://app.example.com/reset?t=1');
  });

  it('does not email a team alert when no team inbox is configured', async () => {
    const { sendAccountDeletedEmail } = await loadSelfHosted();

    await expect(sendAccountDeletedEmail({ appuserKey: 1, deletedAt: new Date(), userEmail: 'u@example.com' })).resolves.toEqual({ type: 'intercepted' });
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it('delivers a bank-recovery nudge through the configured transport', async () => {
    const { sendBankRecoveryEmail } = await loadSelfHosted();

    const outcome = await sendBankRecoveryEmail({
      incidentId: 'incident-1',
      language: 'EN',
      recipient: 'private@example.com',
      recoveryUrl: 'https://app.example.com/accounts',
      templateVersion: 'bank-recovery-v1',
      unsubscribeUrl: 'https://api.example.com/v1/marketing/email-opt-out?token=abc',
    });

    expect(outcome).toEqual({ messageId: expect.stringMatching(/^[0-9a-f-]{36}$/u) });
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});
