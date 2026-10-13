import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  createTransport: vi.fn(),
  info: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock('nodemailer', () => ({ default: { createTransport: mocked.createTransport } }));
vi.mock('@utils/logger', () => ({ default: { error: vi.fn(), info: mocked.info, warn: vi.fn() } }));

import { emailSender, resolveEmailDriver, sendWithTransport, supportInbox } from '../email-transport';

const message = {
  from: 'WonderMoney <hello@example.com>',
  headers: { 'List-Unsubscribe': '<https://api.example.com/opt-out>' },
  html: '<p>Reset: https://app.example.com/reset?token=abc</p>',
  subject: 'Reset your password',
  text: 'Reset: https://app.example.com/reset?token=abc',
  to: 'person@example.com',
};

describe('resolveEmailDriver', () => {
  it('logs instead of sending when nothing is configured, so a single-user install still works', () => {
    expect(resolveEmailDriver({})).toBe('log');
  });

  it('keeps Resend wherever its key is set, and uses SMTP when that is what is configured', () => {
    expect(resolveEmailDriver({ RESEND_API_KEY: 're_123' })).toBe('resend');
    expect(resolveEmailDriver({ SMTP_HOST: 'smtp.example.com' })).toBe('smtp');
  });

  it('lets EMAIL_DRIVER override the inference', () => {
    expect(resolveEmailDriver({ EMAIL_DRIVER: 'log', RESEND_API_KEY: 're_123' })).toBe('log');
  });
});

describe('emailSender and supportInbox', () => {
  it('prefers EMAIL_FROM and falls back to the Resend-era variables', () => {
    expect(emailSender({ EMAIL_FROM: 'a@example.com', EMAIL_FROM_NAME: 'Home Finance', RESEND_FROM_EMAIL: 'b@example.com' })).toEqual({ email: 'a@example.com', name: 'Home Finance' });
    expect(emailSender({ RESEND_FROM_EMAIL: 'b@example.com', RESEND_FROM_NAME: 'WonderMoney' })).toEqual({ email: 'b@example.com', name: 'WonderMoney' });
    expect(emailSender({}).email).toMatch(/@/);
  });

  it('has no team inbox unless one is configured', () => {
    expect(supportInbox({})).toBeNull();
    expect(supportInbox({ SUPPORT_EMAIL: 'help@example.com' })).toBe('help@example.com');
  });
});

describe('sendWithTransport', () => {
  beforeEach(() => {
    mocked.createTransport.mockReset();
    mocked.sendMail.mockReset();
    mocked.info.mockReset();
    mocked.createTransport.mockReturnValue({ sendMail: mocked.sendMail });
  });

  it('writes the whole message, links included, to the log on the log driver', async () => {
    await expect(sendWithTransport(message, {}, { EMAIL_DRIVER: 'log' })).resolves.toMatchObject({ type: 'accepted' });
    expect(JSON.stringify(mocked.info.mock.calls)).toContain('https://app.example.com/reset?token=abc');
  });

  it('sends through SMTP with the configured server and reports the message as accepted', async () => {
    mocked.sendMail.mockResolvedValue({ messageId: '<abc@example.com>' });
    const env = { SMTP_HOST: 'smtp.example.com', SMTP_PASSWORD: 'pw', SMTP_PORT: '465', SMTP_USER: 'user' };

    await expect(sendWithTransport(message, {}, env)).resolves.toEqual({ providerMessageIds: ['<abc@example.com>'], type: 'accepted' });
    expect(mocked.createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: { pass: 'pw', user: 'user' }, host: 'smtp.example.com', port: 465, secure: true }));
    expect(mocked.sendMail).toHaveBeenCalledWith(expect.objectContaining({ headers: message.headers, subject: message.subject, to: message.to }));
  });

  it.each([
    [{ responseCode: 451 }, { retryable: true, type: 'rejected' }],
    [{ responseCode: 550 }, { retryable: false, type: 'rejected' }],
    [{ code: 'ECONNECTION' }, { retryable: true, type: 'rejected' }],
    [{ code: 'ETIMEDOUT' }, { type: 'unknown' }],
  ])('classifies an SMTP failure %j', async (error, outcome) => {
    mocked.sendMail.mockRejectedValue(Object.assign(new Error('smtp failure'), error));
    await expect(sendWithTransport(message, {}, { SMTP_HOST: 'smtp.example.com' })).resolves.toMatchObject(outcome);
  });
});
