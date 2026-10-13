import { beforeEach, describe, expect, it, vi } from 'vitest';

const pinoHttpMock = vi.fn();

vi.mock('pino-http', () => ({
  default: pinoHttpMock,
}));

vi.mock('@utils/logger', () => ({
  default: {},
}));

describe('http logger sanitization', () => {
  beforeEach(() => {
    pinoHttpMock.mockClear();
  });

  it('sanitizes logger messages and params', async () => {
    await import('@utils/logger-http');

    const options = pinoHttpMock.mock.calls[0]?.[0];
    if (!options) throw new Error('pino-http options were not captured');
    expect(options.customReceivedMessage({ method: 'GET', url: '/v1/accounts/123?email=test@example.com' })).toBe('GET /v1/accounts/[REDACTED]?email=%5BREDACTED%5D');
    expect(options.customReceivedMessage({ method: 'GET', url: '/v1/marketing/email-opt-out?token=signed-secret-value' })).toBe('GET /v1/marketing/email-opt-out?token=%5BREDACTED%5D');
    expect(options.customSuccessMessage({ method: 'GET', url: '/v1/accounts/123' }, { statusCode: 200 }, 12)).toBe('GET /v1/accounts/[REDACTED] 200 12ms');
    expect(options.customErrorMessage({ method: 'GET', url: '/v1/accounts/123' }, { statusCode: 500 }, { message: 'boom' })).toBe('GET /v1/accounts/[REDACTED] 500: boom');

    const serialized = options.serializers.req({
      connection: { remoteAddress: '127.0.0.1' },
      headers: {},
      method: 'GET',
      params: { accountId: '123', token: 'secret' },
      query: { email: 'test@example.com' },
      res: { statusCode: 400 },
      url: '/v1/accounts/123?email=test@example.com',
    });

    expect(serialized).toEqual({
      headers: {
        authorization: undefined,
        'content-length': undefined,
        'content-type': undefined,
        'user-agent': undefined,
        'x-request-id': undefined,
      },
      method: 'GET',
      parameters: { accountId: '[REDACTED]', token: '[REDACTED]' },
      query: { email: '[REDACTED]' },
      remoteAddress: '127.0.0.1',
      url: '/v1/accounts/[REDACTED]?email=%5BREDACTED%5D',
    });
  });
});
